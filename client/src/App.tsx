import { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { getBoard, loadBoards, type BoardGrid } from './boards'

// Get API base URL - use environment variable if set, otherwise use window.location.origin in production
const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  return process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:3001'
}

type Phase = 'lobby' | 'countdown' | 'calling'
type Page = 'login' | 'welcome' | 'instructions' | 'depositSelect' | 'depositConfirm' | 'withdrawal' | 'lobby' | 'game'

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [playerId, setPlayerId] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  const [username, setUsername] = useState<string>('')
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false)
  const [loginMode, setLoginMode] = useState<'login' | 'signup'>('login')
  const [loginUsername, setLoginUsername] = useState<string>('')
  const [loginPassword, setLoginPassword] = useState<string>('')
  const [loginError, setLoginError] = useState<string>('')
  const [loginLoading, setLoginLoading] = useState<boolean>(false)
  const [stake, setStake] = useState<number>(10)
  const [phase, setPhase] = useState<Phase>('lobby')
  const [seconds, setSeconds] = useState<number>(60)
  const [prize, setPrize] = useState<number>(0)
  const [players, setPlayers] = useState<number>(0)
  const [takenBoards, setTakenBoards] = useState<number[]>([])
  const [waitingPlayers, setWaitingPlayers] = useState<number>(0)
  const [isWaiting, setIsWaiting] = useState<boolean>(false)
  const [betHouses, setBetHouses] = useState<any[]>([])
  const [currentBetHouse, setCurrentBetHouse] = useState<number | null>(null)
  const [balance, setBalance] = useState<number>(0)
  const [bonus, setBonus] = useState<number>(0)
  const [called, setCalled] = useState<number[]>([])
  const [picks, setPicks] = useState<number[]>([])
  const [activeGameBoardId, setActiveGameBoardId] = useState<number | null>(null)
  const [boardHtmlProvided, setBoardHtmlProvided] = useState<boolean>(false)
  const [currentPage, setCurrentPage] = useState<Page>('login')
  const [isReady, setIsReady] = useState<boolean>(false)
  const [markedNumbers, setMarkedNumbers] = useState<Set<number>>(new Set())
  const [callCountdown, setCallCountdown] = useState<number>(0)
  const [lastCalled, setLastCalled] = useState<number | null>(null)
  const [autoMark, setAutoMark] = useState<boolean>(false)
  const [autoAlgoMark, setAutoAlgoMark] = useState<boolean>(false)
  const [autoBingo, setAutoBingo] = useState<boolean>(false)
  const [winnerInfo, setWinnerInfo] = useState<{
    playerId: string
    prize: number
    stake: number
    boardId?: number
    lineIndices?: number[]
  } | null>(null)
  const [audioPack, setAudioPack] = useState<string>('amharic') // 'amharic' | 'modern-amharic'
  const [audioOn, setAudioOn] = useState<boolean>(true)
  const callTimerRef = useRef<number | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [depositAmount, setDepositAmount] = useState<string>('')
  const [depositMessage, setDepositMessage] = useState<string>('')
  const [depositVerifying, setDepositVerifying] = useState<boolean>(false)
  const [withdrawalAmount, setWithdrawalAmount] = useState<string>('')
  const [withdrawalAccount, setWithdrawalAccount] = useState<string>('')
  const [withdrawalMessage, setWithdrawalMessage] = useState<string>('')
  const [withdrawalVerifying, setWithdrawalVerifying] = useState<boolean>(false)
  const [currentWithdrawalPage, setCurrentWithdrawalPage] = useState<'form' | 'confirm'>('form')
  const autoBingoSentRef = useRef<boolean>(false)

  // Check for existing session on mount
  useEffect(() => {
    try {
      const savedUserId = localStorage.getItem('userId')
      const savedUsername = localStorage.getItem('username')
      const savedToken = localStorage.getItem('authToken')
      if (savedUserId && savedUsername && savedToken) {
        // Verify session with server
        fetch(`${getApiUrl()}/api/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: savedUserId, token: savedToken }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              setUserId(savedUserId)
              setUsername(savedUsername)
              setIsAuthenticated(true)
              setCurrentPage('welcome')
            } else {
              localStorage.removeItem('userId')
              localStorage.removeItem('username')
              localStorage.removeItem('authToken')
            }
          })
          .catch(() => {
            localStorage.removeItem('userId')
            localStorage.removeItem('username')
            localStorage.removeItem('authToken')
          })
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    
    const s = io(getApiUrl(), { 
      // Allow both websocket and polling so poor networks can still receive calls reliably
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: { userId, username }
    })
    setSocket(s)
    
    s.on('init', (d: any) => {
      setPhase(d.phase)
      setSeconds(d.seconds)
      setStake(d.stake)
      setPrize(d.prize)
      setCalled(d.called)
      setPlayerId(d.playerId)
      setIsWaiting(d.isWaiting || false)
      setCurrentBetHouse(d.stake)
      // Only redirect to game if we're already in lobby, not if we're on welcome page
      if (d.phase === 'calling' && !d.isWaiting && currentPage === 'lobby') {
        setCurrentPage('game')
      }
    })
    
    s.on('tick', (d: any) => { 
      setSeconds(d.seconds)
      setPlayers(d.players)
      setPrize(d.prize)
      setStake(d.stake)
    })
    
    s.on('phase', (d: any) => {
      setPhase(d.phase)
      // If game starts and we're in lobby and not waiting, redirect to game
      if (d.phase === 'calling' && currentPage === 'lobby' && !isWaiting) {
        setCurrentPage('game')
      }
      // Whenever phase switches back to lobby, reset local selection state
      if (d.phase === 'lobby') {
        setPicks([])
        setMarkedNumbers(new Set())
        setIsReady(false)
        setIsWaiting(false)
        autoBingoSentRef.current = false
      }
    })
    
    s.on('players', (d: any) => {
      setPlayers(d.count || 0)
      setWaitingPlayers(d.waitingCount || 0)
    })
    
    s.on('bet_houses_status', (d: any) => {
      if (d.betHouses) {
        setBetHouses(d.betHouses)
      }
    })

    // Boards reserved in this room
    s.on('boards_taken', (d: any) => {
      if (d.takenBoards) {
        setTakenBoards(d.takenBoards as number[])
      }
    })

    // 🔧 FIXED: Call event handler with proper auto bingo trigger
        // 🔧 FIXED: Call event handler with proper auto bingo trigger
        s.on('call', (d: any) => {
          setCalled(d.called)
          setLastCalled(d.number)
          setCallCountdown(5)
          
          // Auto-mark numbers if enabled
          if (autoMark || autoAlgoMark) {
            setMarkedNumbers(prev => {
              const next = new Set(prev)
              next.add(d.number)
              return next
            })
          }
          
          // 🔧 FIXED AUTO BINGO: Use fresh called array directly, not stale state
          if (autoBingoRef.current && !autoBingoSentRef.current && currentBetHouse) {
            // Always use the server's called array for auto-algo mode
            const freshMarks = new Set<number>(d.called)
            
            // Check if any board has a winning line that includes the just-called number
            const winResult = findBingoWinWithLastCalled(freshMarks, d.number, picksRef.current)
            
            if (winResult) {
              autoBingoSentRef.current = true
              s.emit('bingo', { stake: currentBetHouse })
            }
          }
          
          // Play audio for active players
          if (audioOnRef.current && !isWaitingRef.current && phaseRef.current === 'calling') {
            playCallSound(d.number)
          }
        })
    // 🔧 FIXED: Winner event handler with server-side board support
        // 🔧 FIXED: Winner event - compute winning board and line
        s.on('winner', (d: any) => {
          let boardId: number | undefined
          let lineIndices: number[] | undefined
          
          // Use server data if provided
          if (d.boardId && Array.isArray(d.lineIndices)) {
            boardId = d.boardId
            lineIndices = d.lineIndices
          } else {
            // Compute locally using called numbers
            const marks = new Set<number>(d.called || called)
            const win = findAnyBingoWin(marks, picksRef.current)
            if (win) {
              boardId = win.boardId
              lineIndices = win.line
            }
          }
          
          setWinnerInfo({
            playerId: d.playerId,
            prize: d.prize,
            stake: d.stake,
            boardId,
            lineIndices,
          })
          
          setPicks([])
          setMarkedNumbers(new Set())
          setCurrentPage('lobby')
          setIsReady(false)
          setIsWaiting(false)
          autoBingoSentRef.current = false
        })
    
    s.on('game_start', () => {
      if (!isWaiting) {
        setCurrentPage('game')
      }
      autoBingoSentRef.current = false
    })
    
    s.on('start_game_confirm', (d: any) => {
      if (d.isWaiting) {
        setIsWaiting(true)
        // Stay on lobby/board selection page if waiting
      } else {
        setCurrentPage('game')
        setIsWaiting(false)
      }
    })
    
    s.on('balance_update', (d: any) => {
      setBalance(d.balance || 0)
    })
    
    // Request bet houses status on connection
    s.emit('get_bet_houses_status')
    
    return () => { s.disconnect() }
  }, [isAuthenticated, userId, username])
  
  // Don't auto-join - let user select bet house from welcome page

  // Keep a valid active board selection on the game page (mobile uses this for tab switching)
  useEffect(() => {
    if (currentPage !== 'game') return
    setActiveGameBoardId(prev => {
      if (prev && picks.includes(prev)) return prev
      return picks[0] ?? null
    })
  }, [currentPage, picks])

  // Restore picks from localStorage and persist changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem('picks')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) setPicks(parsed)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('picks', JSON.stringify(picks))
    } catch {}
  }, [picks])

  // Load boards HTML
  useEffect(() => {
    fetch('/boards.html')
      .then((r) => r.text())
      .then((html) => { 
        loadBoards(html)
        setBoardHtmlProvided(true) 
      })
      .catch(() => setBoardHtmlProvided(false))
  }, [])

  useEffect(() => { 
    if (socket && currentBetHouse) {
      socket.emit('select_numbers', { picks, stake: currentBetHouse }) 
    }
  }, [socket, picks, currentBetHouse])


  // Manage 5s per-call countdown lifecycle
  useEffect(() => {
    if (phase !== 'calling') {
      setCallCountdown(0)
      return
    }
    if (callCountdown <= 0) return
    const id = window.setInterval(() => {
      setCallCountdown(prev => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase, callCountdown])

  const board = useMemo(() => Array.from({ length: 100 }, (_, i) => i + 1), [])

  const togglePick = (n: number) => {
    // Allow picking boards even during live games (if waiting)
    if (phase !== 'lobby' && phase !== 'countdown' && !isWaiting) return
    // Prevent selecting boards that are already taken by other players
    const isTaken = takenBoards.includes(n)
    const isAlreadyPicked = picks.includes(n)
    if (isTaken && !isAlreadyPicked) return
    setPicks(prev => {
      if (prev.includes(n)) return prev.filter(x => x !== n)
      if (prev.length >= 2) return prev
      return [...prev, n]
    })
  }

  const handleJoinBetHouse = (stakeAmount: number) => {
    if (!socket) return
    setCurrentBetHouse(stakeAmount)
    setStake(stakeAmount)
    setPicks([])
    setIsReady(false)
    setIsWaiting(false)
    socket.emit('join_bet_house', stakeAmount)
    // Only go to lobby if user explicitly joined (not on initial connection)
    // If already on welcome page, stay there until they click "Play now"
    if (currentPage !== 'welcome') {
      setCurrentPage('lobby')
    }
  }

  const handleStartGame = () => {
    if (picks.length === 0) {
      alert('Please select at least one board before starting!')
      return
    }
    if (!currentBetHouse) {
      alert('Please select a bet house first!')
      return
    }
    setIsReady(true)
    socket?.emit('start_game', { stake: currentBetHouse })
    // If not waiting, redirect immediately; otherwise stay on lobby
    if (!isWaiting) {
    setCurrentPage('game')
    }
  }

  const toggleMark = (number: number) => {
    if (phase !== 'calling') return
    if (autoAlgoMark) return // disable manual marking when auto algorithm is enabled
    setMarkedNumbers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(number)) {
        newSet.delete(number)
      } else {
        newSet.add(number)
      }
      return newSet
    })
  }

  const checkBingo = (board: BoardGrid): boolean => {
    // Check rows
    for (let row = 0; row < 5; row++) {
      let count = 0
      for (let col = 0; col < 5; col++) {
        const idx = row * 5 + col
        const num = board[idx]
        if (num === -1 || markedNumbers.has(num)) count++
      }
      if (count === 5) return true
    }
    
    // Check columns
    for (let col = 0; col < 5; col++) {
      let count = 0
      for (let row = 0; row < 5; row++) {
        const idx = row * 5 + col
        const num = board[idx]
        if (num === -1 || markedNumbers.has(num)) count++
      }
      if (count === 5) return true
    }
    
        // Check diagonals
        let count1 = 0, count2 = 0
        for (let i = 0; i < 5; i++) {
          const num1 = board[i * 5 + i]
          const num2 = board[i * 5 + (4 - i)]
          if (num1 === -1 || markedNumbers.has(num1)) count1++
          if (num2 === -1 || markedNumbers.has(num2)) count2++
        }
        return count1 === 5 || count2 === 5
      }
    
      const canBingo = picks.some(boardId => {
        const board = getBoard(boardId)
        return board ? checkBingo(board) : false
      })
    
      // Core bingo checker given an explicit set of marked numbers and a last-called value.
      const hasBingoWithMarksAndLast = (
        marks: Set<number>,
        last: number | null,
        boardIdsOverride?: number[]
      ): boolean => {
        if (!last) return false
        const boardsToCheck = boardIdsOverride ?? picks
        for (const boardId of boardsToCheck) {
          const grid = getBoard(boardId)
          if (!grid) continue
          // map grid indices to numbers for quick checks
          const lines: number[][] = []
          // rows
          for (let r = 0; r < 5; r++) {
            lines.push([0,1,2,3,4].map(c => grid[r*5 + c]))
          }
          // cols
          for (let c = 0; c < 5; c++) {
            lines.push([0,1,2,3,4].map(r => grid[r*5 + c]))
          }
          // diagonals
          lines.push([0,1,2,3,4].map(i => grid[i*5 + i]))
          lines.push([0,1,2,3,4].map(i => grid[i*5 + (4-i)]))
    
          for (const line of lines) {
            const containsLast = line.includes(last)
            if (!containsLast) continue
            const complete = line.every(n => n === -1 || marks.has(n))
            if (complete) return true
          }
        }
        return false
      }
    
      // Generic bingo finder that ignores "last called" and returns the first winning line, if any.
      const findAnyBingoWin = (
        marks: Set<number>,
        boardIdsOverride?: number[]
      ): { boardId: number; line: number[] } | null => {
        const boardsToCheck = boardIdsOverride ?? picks
        for (const boardId of boardsToCheck) {
          const grid = getBoard(boardId)
          if (!grid) continue
          const lines: number[][] = []
          for (let r = 0; r < 5; r++) {
            lines.push([0,1,2,3,4].map(c => r * 5 + c))
          }
          for (let c = 0; c < 5; c++) {
            lines.push([0,1,2,3,4].map(r => r * 5 + c))
          }
          lines.push([0,1,2,3,4].map(i => i * 5 + i))
          lines.push([0,1,2,3,4].map(i => i * 5 + (4 - i)))
    
          for (const idxLine of lines) {
            const complete = idxLine.every(idx => {
              const num = grid[idx]
              return num === -1 || marks.has(num)
            })
            if (complete) {
              return { boardId, line: idxLine }
            }
          }
        }
        return null
      }
        // 🔧 NEW: Find bingo win that includes the last called number
  const findBingoWinWithLastCalled = (
    marks: Set<number>,
    lastCalledNum: number,
    boardIdsOverride?: number[]
  ): { boardId: number; line: number[] } | null => {
    const boardsToCheck = boardIdsOverride ?? picks
    for (const boardId of boardsToCheck) {
      const grid = getBoard(boardId)
      if (!grid) continue
      
      // All possible lines (rows, cols, diagonals) as index arrays
      const lines: number[][] = []
      // Rows
      for (let r = 0; r < 5; r++) {
        lines.push([0, 1, 2, 3, 4].map(c => r * 5 + c))
      }
      // Columns
      for (let c = 0; c < 5; c++) {
        lines.push([0, 1, 2, 3, 4].map(r => r * 5 + c))
      }
      // Diagonals
      lines.push([0, 6, 12, 18, 24]) // top-left to bottom-right
      lines.push([4, 8, 12, 16, 20]) // top-right to bottom-left

      for (const idxLine of lines) {
        // Check if this line contains the last called number
        const lineNumbers = idxLine.map(idx => grid[idx])
        const containsLastCalled = lineNumbers.includes(lastCalledNum)
        
        if (!containsLastCalled) continue
        
        // Check if line is complete (all marked or FREE)
        const isComplete = idxLine.every(idx => {
          const num = grid[idx]
          return num === -1 || marks.has(num)
        })
        
        if (isComplete) {
          return { boardId, line: idxLine }
        }
      }
    }
    return null
  }
      // Ensure a win line exists that includes the most recent called number.
      // Optional overrides let us validate immediately on a fresh server call payload.
      const hasBingoIncludingLastCalled = (
        overrideCalled?: number[],
        overrideLastCalled?: number | null
      ): boolean => {
        const effectiveLastCalled = overrideLastCalled ?? lastCalled
        if (!effectiveLastCalled) return false
        // Effective marked set: when auto algorithm is on, use called numbers as marks
        const effectiveCalled = overrideCalled ?? called
        const marks = new Set<number>(
          autoAlgoMark ? effectiveCalled : Array.from(markedNumbers)
        )
        return hasBingoWithMarksAndLast(marks, effectiveLastCalled)
      }
    
      const onPressBingo = (overrideCalled?: number[], overrideLastCalled?: number | null) => {
        if (phase !== 'calling' || isWaiting) return
        // Validate locally before notifying server
        if (!hasBingoIncludingLastCalled(overrideCalled, overrideLastCalled)) {
          alert('No valid BINGO found that includes the last called number. Keep marking!')
          return
        }
        if (!currentBetHouse) return
        socket?.emit('bingo', { stake: currentBetHouse })
      }
    
      // Render 75-number caller grid with B I N G O columns
      const renderCallerGrid = (currentNumber?: number) => {
        const columns: number[][] = [
          Array.from({ length: 15 }, (_, i) => i + 1),
          Array.from({ length: 15 }, (_, i) => i + 16),
          Array.from({ length: 15 }, (_, i) => i + 31),
          Array.from({ length: 15 }, (_, i) => i + 46),
          Array.from({ length: 15 }, (_, i) => i + 61),
        ];
      
        const headers = ['B', 'I', 'N', 'G', 'O'];
        const headerColors = [
          'bg-blue-500', 'bg-pink-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500'
        ];
      
        return (
          <div className="flex flex-col h-full w-full bg-slate-900/50 rounded-2xl p-2 border border-white/10 shadow-2xl">
            {/* Headers */}
            <div className="grid grid-cols-5 gap-1.5 mb-2">
              {headers.map((h, i) => (
                <div
                  key={h}
                  className={`${headerColors[i]} text-white rounded-lg text-center font-black py-1 shadow-lg text-sm tracking-widest`}
                >
                  {h}
                </div>
              ))}
            </div>
      
            {/* 5 columns of numbers - flex-1 makes this stretch to fill height */}
            <div className="grid grid-cols-5 gap-1.5 flex-1">
              {columns.map((col, colIndex) => (
                <div key={colIndex} className="grid grid-rows-15 gap-1 h-full">
                  {col.map((num) => {
                    const isCalled = called.includes(num);
                    const isCurrent = currentNumber === num;
                    return (
                      <div
                        key={num}
                        className={[
                          'w-full flex items-center justify-center text-[10px] sm:text-xs font-bold rounded-md transition-all duration-300 border',
                          isCurrent
                            ? 'bg-amber-400 text-black border-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.9)] scale-110 z-20 animate-pulse'
                            : isCalled
                            ? 'bg-emerald-500 text-black border-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.5)] scale-105 z-10'
                            : 'bg-slate-800/80 text-slate-400 border-white/5'
                        ].join(' ')}
                      >
                        {num}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      };
    
      // Audio: try to play a sound for each call using selected pack
      const numberToLetter = (n: number) => (n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O')
    
      // Helper: convert number to its spoken word for display (1–75)
      const numberToWord = (n: number): string => {
        const ones = [
          '',
          'ONE',
          'TWO',
          'THREE',
          'FOUR',
          'FIVE',
          'SIX',
          'SEVEN',
          'EIGHT',
          'NINE',
          'TEN',
          'ELEVEN',
          'TWELVE',
          'THIRTEEN',
          'FOURTEEN',
          'FIFTEEN',
          'SIXTEEN',
          'SEVENTEEN',
          'EIGHTEEN',
          'NINETEEN',
        ]
        const tens = ['', 'TEN', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY']
    
        if (n === 0) return 'ZERO'
        if (n < 20) return ones[n]
        const t = Math.floor(n / 10)
        const o = n % 10
        if (o === 0) return tens[t]
        return `${tens[t]}-${ones[o]}`
      }
    
      // Cache audio elements and latest flags so calls play instantly and only for active players
      const audioCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map())
      const audioOnRef = useRef<boolean>(audioOn)
      const isWaitingRef = useRef<boolean>(isWaiting)
      const phaseRef = useRef<Phase>(phase)
      const picksRef = useRef<number[]>(picks)
      const autoAlgoMarkRef = useRef<boolean>(autoAlgoMark)
      const autoBingoRef = useRef<boolean>(autoBingo)
    
      useEffect(() => { audioOnRef.current = audioOn }, [audioOn])
      useEffect(() => { isWaitingRef.current = isWaiting }, [isWaiting])
      useEffect(() => { phaseRef.current = phase }, [phase])
      useEffect(() => { picksRef.current = picks }, [picks])
      useEffect(() => { autoAlgoMarkRef.current = autoAlgoMark }, [autoAlgoMark])
      useEffect(() => { autoBingoRef.current = autoBingo }, [autoBingo])
      // Parse amount from deposit/withdrawal message
      const parseAmount = (message: string): number | null => {
        // Look for patterns like: "100.00", "100 Birr", "ETB 100", "100 ETB", etc.
        const patterns = [
          /(\d+\.?\d*)\s*(?:birr|etb|br)/i,
          /(?:birr|etb|br)\s*(\d+\.?\d*)/i,
          /amount[:\s]*(\d+\.?\d*)/i,
          /(\d+\.?\d*)\s*(?:sent|transferred|deposited|credited)/i,
        ]
        for (const pattern of patterns) {
          const match = message.match(pattern)
          if (match) {
            const amount = parseFloat(match[1])
            if (!isNaN(amount) && amount > 0) return amount
          }
        }
        // Fallback: find standalone numbers that could be amounts
        const numbers = message.match(/\b(\d{2,}(?:\.\d{2})?)\b/g)
        if (numbers && numbers.length > 0) {
          // Prefer numbers that look like currency amounts (2+ digits, possibly with decimals)
          const amounts = numbers.map(n => parseFloat(n)).filter(n => !isNaN(n) && n >= 10)
          if (amounts.length > 0) return Math.max(...amounts)
        }
        return null
      }
    
      const parseTransactionId = (text: string): string | null => {
        // Look for common tags: Txn, Trans, Ref, Reference, ID
        const patterns = [
          /(?:txn|trans|ref|reference|transaction\s*id|id)[:\s-]*([A-Z0-9]{6,})/i,
          /(?:txn|trans|ref|reference|transaction\s*id|id)[:\s-]*([a-z0-9]{6,})/i,
        ]
        for (const pattern of patterns) {
          const match = text.match(pattern)
          if (match) return match[1].trim().toUpperCase()
        }
        // Fallback: longest alphanumeric token 8-20 chars
        const tokens = text.match(/[A-Z0-9]{8,20}/gi)
        if (tokens) {
          const sorted = tokens.sort((a,b)=>b.length-a.length)
          return sorted[0].toUpperCase()
        }
        return null
      }
    
      // Verify deposit message
      const verifyDepositMessage = async (
        message: string,
        expectedAmount: number,
        expectedAccount: string,
        expectedName: string
      ): Promise<{ valid: boolean; reason?: string; transactionId?: string; detectedAmount?: number }> => {
        const msgLower = message.toLowerCase()
        const msgNoSpaces = message.replace(/\s+/g, '')
        const accountNoSpaces = expectedAccount.replace(/\s+/g, '')
        
        // Check account number (REQUIRED)
        if (!msgNoSpaces.includes(accountNoSpaces)) {
          return { valid: false, reason: 'Account number not found in the message. Please ensure you deposited to the correct account.' }
        }
        
        // Check account holder name (OPTIONAL - if present, good; if not, that's fine as long as account number matches)
        const nameParts = expectedName.toLowerCase().split(' ')
        const nameFound = nameParts.some(part => part.length > 2 && msgLower.includes(part))
        // Note: We don't fail if name is not found - account number is the primary verification
        
        // Extract and verify amount
        const detectedAmount = parseAmount(message)
        if (!detectedAmount) {
          return { valid: false, reason: 'Could not detect amount from the message. Please include the amount in your message.' }
        }
        
        // Allow small tolerance (0.01) for rounding
        if (Math.abs(detectedAmount - expectedAmount) > 0.01) {
          return { 
            valid: false, 
            reason: `Amount mismatch. Expected: ${expectedAmount} Birr, Found: ${detectedAmount} Birr. Please verify the amount.`,
            detectedAmount 
          }
        }
        
        // Extract transaction ID
        const transactionId = parseTransactionId(message)
        if (!transactionId) {
          return { valid: false, reason: 'Transaction ID not found in the message. Please include the transaction reference.' }
        }
        
        return { valid: true, transactionId, detectedAmount }
      }
      const playCallSound = async (n: number) => {
        const letter = numberToLetter(n)
        // Always fetch audio from the server to avoid client-origin path issues
        const base = `${getApiUrl()}/audio/${audioPack}`
        const candidates = [
          `${base}/${letter}-${n}.mp3`,
          `${base}/${letter}_${n}.mp3`,
          `${base}/${letter}/${n}.mp3`,
          `${base}/${n}.mp3`,
          `${base}/${letter}${n}.mp3`,
        ]
        for (const src of candidates) {
          try {
            let audio = audioCacheRef.current.get(src)
            if (!audio) {
              audio = new Audio(src)
              audioCacheRef.current.set(src, audio)
              // Wait for the first load only
              await new Promise<void>((resolve, reject) => {
                audio!.oncanplaythrough = () => resolve()
                audio!.onerror = reject
              })
            }
            audio.currentTime = 0
            await audio.play()
            break
          } catch (_) {
            continue
          }
        }
      }
    
      const renderCard = (
        boardId: number | null,
        isGamePage: boolean = false,
        highlightLineIndices: number[] = []
      ) => {
        if (!boardId) return null;
        const grid: BoardGrid | null = getBoard(boardId);
        if (!grid) return <div className="text-slate-400 p-4">Board Not Found</div>;
      
        const boardCanBingo = isGamePage ? checkBingo(grid) : false;
        const headers = ['B', 'I', 'N', 'G', 'O'];
        const headerColors = ['bg-blue-500', 'bg-pink-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500'];
      
        return (
          <div className="bg-slate-900/80 rounded-2xl p-3 shadow-2xl border border-white/10 backdrop-blur-sm">
        {/* Modern BINGO Header */}
        <div className="grid grid-cols-5 gap-1.5 mb-3">
          {headers.map((h, idx) => (
            <div
              key={idx}
              className={`${headerColors[idx]} rounded-lg text-center text-white font-black py-1.5 shadow-md text-xs sm:text-sm`}
            >
              {h}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {grid.map((val, idx) => {
            const isFree = val === -1;
            const isCalled = called.includes(val);
            const isMarked = isFree || markedNumbers.has(val);
            const finalState = isGamePage ? (autoAlgoMark ? isCalled || isFree : isMarked) : isCalled;
            const isHighlight = highlightLineIndices.includes(idx);

            return (
              <div
                key={idx}
                onClick={() => isGamePage && !isFree && isCalled && toggleMark(val)}
                className={[
                  'aspect-square rounded-xl flex flex-col items-center justify-center text-sm font-black cursor-pointer relative transition-all duration-200 border-2',
                  isFree
                    ? 'bg-yellow-400 border-yellow-200 text-black shadow-lg animate-pulse'
                    : finalState
                    ? isHighlight
                      ? 'bg-emerald-400 border-amber-300 text-black shadow-[0_0_18px_rgba(251,191,36,0.9)] scale-105'
                      : 'bg-emerald-500 border-emerald-300 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                ].join(' ')}
              >
                {isFree ? (
                  <span className="text-[9px] sm:text-[11px] leading-tight">FREE</span>
                ) : (
                  <span className="text-xs sm:text-base">{val}</span>
                )}
                
                {/* If Bingo is possible, show a small glowing star indicator */}
                {isGamePage && boardCanBingo && finalState && !isFree && (
                  <div className="absolute top-0 right-0 -mr-1 -mt-1 h-3 w-3 bg-white rounded-full shadow-[0_0_8px_white]" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const renderLobbyPage = () => (
    <div className="h-screen bg-slate-900 text-white overflow-y-auto">
      <div className="w-full max-w-4xl mx-auto p-2 sm:p-4">
        <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3 sm:mb-6">
            <div className="text-slate-300 text-xs sm:text-sm">ID: <span className="font-mono">{playerId.slice(0,8)}</span></div>
            <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm">
              <span>Stake: <b>{stake} Birr</b></span>
              <span>Active: <b>{players}</b></span>
              {waitingPlayers > 0 && <span>Waiting: <b>{waitingPlayers}</b></span>}
              <span>Prize: <b>{prize} Birr</b></span>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3 sm:mb-6">
            <div className="text-lg sm:text-2xl font-bold flex items-center flex-wrap gap-2">
              Select Your Boards
              {isWaiting && (
                <span className="px-2 sm:px-3 py-0.5 sm:py-1 rounded bg-yellow-500 text-black text-xs sm:text-sm font-bold">
                  Waiting...
                </span>
              )}
            </div>
            {!isWaiting && (
            <div className="px-3 sm:px-4 py-1 sm:py-2 rounded bg-slate-700 font-mono text-sm sm:text-lg">
              {String(seconds).padStart(2,"0")}s
            </div>
            )}
            {isWaiting && (
              <div className="px-3 sm:px-4 py-1 sm:py-2 rounded bg-yellow-500/20 text-yellow-400 font-mono text-xs sm:text-sm">
                Game in progress
              </div>
            )}
          </div>

          {/* Audio and Auto Mark toggles visible before countdown */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-3 sm:mb-6">
            <label className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <span className="text-slate-300">Audio:</span>
              <select
                className="bg-slate-700 text-slate-100 rounded px-1 sm:px-2 py-0.5 sm:py-1 text-xs sm:text-sm"
                value={audioPack}
                onChange={(e) => setAudioPack(e.target.value)}
              >
                <option value="amharic">Amharic</option>
                <option value="modern-amharic">Modern Amharic</option>
              </select>
              <input type="checkbox" checked={audioOn} onChange={(e) => setAudioOn(e.target.checked)} className="w-3 h-3 sm:w-4 sm:h-4" />
              <button
                className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-slate-700 hover:brightness-110 text-xs sm:text-sm"
                onClick={() => playCallSound(1)}
              >
                Test
              </button>
            </label>
            <label className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <input
                type="checkbox"
                checked={autoMark}
                onChange={(e) => setAutoMark(e.target.checked)}
                className="w-3 h-3 sm:w-4 sm:h-4"
              />
              <span className="text-slate-300">Auto mark (me)</span>
            </label>
            <label className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <input
                type="checkbox"
                checked={autoAlgoMark}
                onChange={(e) => setAutoAlgoMark(e.target.checked)}
                className="w-3 h-3 sm:w-4 sm:h-4"
              />
              <span className="text-slate-300">Auto algorithm mark</span>
            </label>
          </div>
          
          <div className="grid grid-cols-10 gap-1 sm:gap-2 mb-3 sm:mb-6">
            {board.map(n => {
              const isPicked = picks.includes(n)
              const isTaken = takenBoards.includes(n)
              const disabled = (phase !== 'lobby' && phase !== 'countdown' && !isWaiting) || (isTaken && !isPicked)
              return (
                <button
                  key={n}
                  onClick={() => togglePick(n)}
                  disabled={disabled}
                  className={[
                    "aspect-square rounded text-xs md:text-sm flex items-center justify-center border font-semibold",
                    isPicked ? "bg-amber-500 border-amber-400 text-black" : isTaken ? "bg-slate-900 border-slate-800 text-slate-600" : "bg-slate-700 border-slate-600",
                    disabled ? "opacity-60 cursor-not-allowed" : "hover:brightness-110"
                  ].join(" ")}
                >
                  {n}
                </button>
              )
            })}
          </div>
          
          {/* Selected Boards Preview */}
          {picks.length > 0 && (
            <div className="mb-3 sm:mb-6">
              <div className="text-slate-300 mb-2 sm:mb-4 text-xs sm:text-sm">Your Selected Boards ({picks.length}/2):</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4">
                {picks.map((boardId, idx) => (
                  <div key={boardId} className="bg-slate-700 rounded-lg p-2 sm:p-4">
                    <div className="text-xs sm:text-sm text-slate-400 mb-1 sm:mb-2">Board {boardId}</div>
                    {renderCard(boardId, false)}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
            <div className="text-slate-300 text-xs sm:text-sm">
              Selected: {picks.length}/2 boards
              {isWaiting && picks.length > 0 && (
                <div className="mt-1 sm:mt-2 text-yellow-400 text-xs sm:text-sm">
                  You'll join the next game when it starts
                </div>
              )}
              {picks.length > 0 && !isWaiting && (
                <div className="flex gap-1 sm:gap-2 mt-1 sm:mt-2">
                  {picks.map(n => (
                    <span key={n} className="px-1.5 sm:px-2 py-0.5 sm:py-1 bg-amber-500 text-black rounded text-xs sm:text-sm">Board {n}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                className="px-3 sm:px-4 py-1.5 sm:py-2 rounded bg-slate-700 hover:bg-slate-600 text-xs sm:text-sm flex-1 sm:flex-none"
                onClick={() => setCurrentPage('welcome')}
              >
                Switch Bet House
              </button>
            <button
              onClick={handleStartGame}
              disabled={picks.length === 0 || isReady}
              className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-bold text-sm sm:text-lg flex-1 sm:flex-none ${
                picks.length > 0 && !isReady 
                  ? 'bg-green-500 hover:bg-green-600 text-black' 
                  : 'bg-slate-700 text-slate-400 cursor-not-allowed'
              }`}
            >
                {isReady ? (isWaiting ? 'Waiting...' : 'Ready!') : 'Start Game'}
        </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderLoginPage = () => (
    <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-md">
        <div className="bg-slate-800 rounded-lg sm:rounded-xl p-4 sm:p-8 space-y-4 sm:space-y-6">
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">WIN BINGO</div>
            <div className="text-slate-400 text-xs sm:text-sm">Welcome! Please sign in or create an account</div>
          </div>
          
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => {
                setLoginMode('login')
                setLoginError('')
              }}
              className={`flex-1 py-2 rounded-lg font-semibold ${
                loginMode === 'login' 
                  ? 'bg-emerald-600 text-white' 
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setLoginMode('signup')
                setLoginError('')
              }}
              className={`flex-1 py-2 rounded-lg font-semibold ${
                loginMode === 'signup' 
                  ? 'bg-emerald-600 text-white' 
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              Sign Up
            </button>
          </div>

          {loginError && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-300 text-sm">
              {loginError}
            </div>
          )}

          <div className="space-y-3 sm:space-y-4">
            <div>
              <label className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2 block">Username</label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full bg-slate-700 rounded-lg p-2 sm:p-3 border border-slate-600 outline-none focus:border-emerald-500 text-sm sm:text-base"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !loginLoading) {
                    if (loginMode === 'login') handleLogin()
                    else handleSignup()
                  }
                }}
              />
            </div>
            <div>
              <label className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2 block">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full bg-slate-700 rounded-lg p-2 sm:p-3 border border-slate-600 outline-none focus:border-emerald-500 text-sm sm:text-base"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !loginLoading) {
                    if (loginMode === 'login') handleLogin()
                    else handleSignup()
                  }
                }}
              />
            </div>
            <button
              onClick={loginMode === 'login' ? handleLogin : handleSignup}
              disabled={!loginUsername.trim() || !loginPassword.trim() || loginLoading}
              className="w-full py-2 sm:py-3 rounded-lg bg-emerald-600 text-white font-bold text-sm sm:text-base disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700"
            >
              {loginLoading ? 'Processing...' : loginMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const handleLogin = async () => {
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError('Please enter username and password')
      return
    }
    
    setLoginLoading(true)
    setLoginError('')
    
    try {
      const response = await fetch(`${getApiUrl()}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      })
      
      const result = await response.json()
      
      if (!result.success) {
        setLoginError(result.error || 'Login failed')
        setLoginLoading(false)
        return
      }
      
      // Save session
      localStorage.setItem('userId', result.userId)
      localStorage.setItem('username', result.username)
      localStorage.setItem('authToken', result.token)
      
      setUserId(result.userId)
      setUsername(result.username)
      setIsAuthenticated(true)
      setLoginUsername('')
      setLoginPassword('')
      setCurrentPage('welcome')
    } catch (e: any) {
      setLoginError('Connection error. Please try again.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleSignup = async () => {
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError('Please enter username and password')
      return
    }
    
    if (loginUsername.trim().length < 3) {
      setLoginError('Username must be at least 3 characters')
      return
    }
    
    if (loginPassword.length < 6) {
      setLoginError('Password must be at least 6 characters')
      return
    }
    
    setLoginLoading(true)
    setLoginError('')
    
    try {
      const response = await fetch(`${getApiUrl()}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      })
      
      const result = await response.json()
      
      if (!result.success) {
        setLoginError(result.error || 'Signup failed')
        setLoginLoading(false)
        return
      }
      
      // Save session
      localStorage.setItem('userId', result.userId)
      localStorage.setItem('username', result.username)
      localStorage.setItem('authToken', result.token)
      
      setUserId(result.userId)
      setUsername(result.username)
      setIsAuthenticated(true)
      setLoginUsername('')
      setLoginPassword('')
      setCurrentPage('welcome')
    } catch (e: any) {
      setLoginError('Connection error. Please try again.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('userId')
    localStorage.removeItem('username')
    localStorage.removeItem('authToken')
    setUserId('')
    setUsername('')
    setIsAuthenticated(false)
    setCurrentPage('login')
    if (socket) {
      socket.disconnect()
      setSocket(null)
    }
  }

  // Welcome page with balance, deposit, instructions, invite, and bet houses
  const renderWelcomePage = () => (
    <div className="h-screen bg-slate-900 text-white overflow-y-auto">
      <div className="w-full max-w-5xl mx-auto p-2 sm:p-4 space-y-2 sm:space-y-4">
        <div className="flex items-center justify-between py-1 sm:py-2">
          <div className="text-lg sm:text-2xl font-bold truncate pr-2">Hello, {username}!</div>
          <div className="flex gap-1 sm:gap-2 flex-shrink-0">
            <button
              className="px-2 sm:px-4 py-1 sm:py-2 rounded bg-amber-500 text-black font-semibold text-xs sm:text-sm"
              onClick={() => setCurrentPage('depositSelect')}
            >
              + Deposit
            </button>
            <button
              className="px-2 sm:px-4 py-1 sm:py-2 rounded bg-blue-500 text-white font-semibold text-xs sm:text-sm"
              onClick={() => setCurrentPage('withdrawal')}
            >
              Withdraw
            </button>
            <button
              className="px-2 sm:px-4 py-1 sm:py-2 rounded bg-slate-700 text-white font-semibold text-xs sm:text-sm"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>

        {/* Balance card */}
        <div className="bg-rose-500/80 rounded-lg sm:rounded-xl p-3 sm:p-5 flex items-center justify-between">
          <div>
            <div className="uppercase text-[10px] sm:text-xs">Balance</div>
            <div className="text-xl sm:text-3xl font-extrabold">{balance} Birr</div>
            <div className="mt-1 sm:mt-2 text-[10px] sm:text-xs opacity-90">Bonus</div>
            <div className="text-sm sm:text-lg font-bold">{bonus} Birr</div>
          </div>
          <div className="text-4xl sm:text-6xl font-black opacity-60">ETB</div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            className="px-2 sm:px-4 py-1.5 sm:py-3 rounded bg-slate-800 hover:bg-slate-700 text-xs sm:text-sm flex-1"
            onClick={() => setCurrentPage('instructions')}
          >
            Instructions
          </button>
          <button
            className="px-2 sm:px-4 py-1.5 sm:py-3 rounded bg-slate-800 hover:bg-slate-700 text-xs sm:text-sm flex-1"
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?ref=${playerId}`)}
          >
            Invite Friends
          </button>
        </div>

        <div className="text-base sm:text-xl font-semibold">Bet Houses</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 pb-2">
          {betHouses.length > 0 ? betHouses.map((house: any) => {
            const cardConfig: Record<number, { label: string; tag: number; color: string }> = {
              10: { label: 'Mini', tag: 15, color: 'bg-sky-600' },
              20: { label: 'Sweety', tag: 74, color: 'bg-orange-500' },
              50: { label: 'Standard', tag: 40, color: 'bg-violet-600' },
              100: { label: 'Grand', tag: 60, color: 'bg-teal-600' },
              200: { label: 'Elite', tag: 75, color: 'bg-emerald-600' },
              500: { label: 'Premium', tag: 80, color: 'bg-purple-600' },
            }
            const config = cardConfig[house.stake] || { label: `${house.stake} Birr`, tag: 0, color: 'bg-slate-600' }
            const isLive = house.phase === 'calling'
            const isCountdown = house.phase === 'countdown'
            const isSelected = currentBetHouse === house.stake
            
            return (
              <div key={house.stake} className={`${config.color} rounded-lg sm:rounded-xl p-3 sm:p-5 flex flex-col gap-2 sm:gap-4 ${isSelected ? 'ring-2 sm:ring-4 ring-yellow-400' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="text-xs sm:text-sm opacity-90">{config.label}</div>
                  {isLive && <span className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-red-500 text-[10px] sm:text-xs font-bold animate-pulse">LIVE</span>}
                  {isCountdown && <span className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-yellow-500 text-[10px] sm:text-xs font-bold">Starting</span>}
                </div>
                <div className="text-xl sm:text-3xl font-extrabold">{house.stake} Birr</div>
                <div className="text-xs sm:text-sm opacity-90 space-y-0.5">
                  <div>Active: {house.activePlayers} players</div>
                  {house.waitingPlayers > 0 && <div>Waiting: {house.waitingPlayers} players</div>}
                  <div>Prize: {house.prize} Birr</div>
                </div>
              <div className="mt-auto flex items-center justify-between gap-2">
                <button
                    className="px-2 sm:px-4 py-1.5 sm:py-2 rounded bg-black/30 hover:bg-black/40 font-semibold text-xs sm:text-sm flex-1"
                  onClick={() => {
                      handleJoinBetHouse(house.stake)
                    setCurrentPage('lobby')
                  }}
                >
                    {isSelected ? 'Go to Lobby' : isLive ? 'Join & Wait' : 'Play now'}
                </button>
                  <div className="h-8 w-8 sm:h-12 sm:w-12 rounded-full bg-black/20 flex items-center justify-center text-sm sm:text-xl font-black flex-shrink-0">{config.tag}</div>
              </div>
            </div>
            )
          }) : (
            // Fallback if bet houses not loaded yet
            [10, 20, 50, 100, 200].map(amount => {
              const cardConfig: Record<number, { label: string; tag: number; color: string }> = {
                10: { label: 'Mini', tag: 15, color: 'bg-sky-600' },
                20: { label: 'Sweety', tag: 74, color: 'bg-orange-500' },
                50: { label: 'Standard', tag: 40, color: 'bg-violet-600' },
                100: { label: 'Grand', tag: 60, color: 'bg-teal-600' },
                200: { label: 'Elite', tag: 75, color: 'bg-emerald-600' },
              }
              const config = cardConfig[amount] || { label: `${amount} Birr`, tag: 0, color: 'bg-slate-600' }
              return (
                <div key={amount} className={`${config.color} rounded-lg sm:rounded-xl p-3 sm:p-5 flex flex-col gap-2 sm:gap-4`}>
                  <div className="text-xs sm:text-sm opacity-90">{config.label}</div>
                  <div className="text-xl sm:text-3xl font-extrabold">{amount} Birr</div>
            <div className="mt-auto flex items-center justify-between gap-2">
              <button
                className="px-2 sm:px-4 py-1.5 sm:py-2 rounded bg-black/30 hover:bg-black/40 text-xs sm:text-sm flex-1"
                onClick={() => {
                        handleJoinBetHouse(amount)
                  setCurrentPage('lobby')
                }}
              >
                Play now
              </button>
                    <div className="h-8 w-8 sm:h-12 sm:w-12 rounded-full bg-black/20 flex items-center justify-center text-sm sm:text-xl font-black flex-shrink-0">{config.tag}</div>
            </div>
          </div>
              )
            })
          )}
        </div>

        <div className="text-[10px] sm:text-xs text-slate-400 pb-2">Version preview</div>
      </div>
    </div>
  )

  const renderInstructionsPage = () => (
    <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-3xl bg-slate-800 rounded-lg sm:rounded-xl p-4 sm:p-6 space-y-3 sm:space-y-4">
        <div className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2">How to play</div>
        <ol className="list-decimal space-y-1 sm:space-y-2 ml-4 sm:ml-5 text-slate-200 text-xs sm:text-sm">
          <li>Choose a bet house (10/20/50/100/200 Birr).</li>
          <li>Select up to 2 boards in the lobby.</li>
          <li>Press Start Game to enter the live game.</li>
          <li>During calling, mark called numbers on your boards or enable auto mark.</li>
          <li>Press BINGO only when a full row/column/diagonal is complete including the last call.</li>
        </ol>
        <div className="text-xl sm:text-2xl font-bold mt-4 sm:mt-6">Deposits & Withdrawals</div>
        <p className="text-slate-200 text-xs sm:text-sm">Use the Deposit button on the Welcome page. Withdrawal flow can be added similarly.</p>
        <div className="flex justify-end">
          <button className="px-3 sm:px-4 py-1.5 sm:py-2 rounded bg-slate-700 text-xs sm:text-sm" onClick={() => setCurrentPage('welcome')}>Back</button>
        </div>
      </div>
    </div>
  )

  const providers = [
    { id: 'telebirr', name: 'Telebirr', logo: '🌀' },
    { id: 'ebirr', name: 'Ebirr', logo: '🟢' },
    { id: 'cbe', name: 'CBE', logo: '🏦' },
    { id: 'awash', name: 'Awash', logo: '🏦' },
    { id: 'dashen', name: 'Dashen', logo: '🏦' },
    { id: 'boa', name: 'Bank of Abyssinia', logo: '🏦' },
  ]

  const providerToAccount: Record<string, { account: string; name: string }> = {
    telebirr: { account: '0966 000 0000', name: 'Company Telebirr' },
    ebirr: { account: '0911 000 000', name: 'Company Ebirr' },
    cbe: { account: '1000533912889', name: 'Eyoel Michael' },
    awash: { account: '01320971375900', name: 'Eyoel Michael' },
    dashen: { account: '0123 4567 8901', name: 'Company Dashen' },
    boa: { account: '0222 3333 4444', name: 'Company BoA' },
  }

  const renderDepositSelect = () => (
    <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-3xl">
        <div className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4">Select Payment Platform</div>
        <div className="bg-emerald-600/80 rounded-lg px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm mb-2 sm:mb-3">Recommended</div>
        <div className="space-y-2 sm:space-y-3">
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelectedProvider(p.id); setCurrentPage('depositConfirm') }}
              className="w-full bg-slate-800 hover:bg-slate-700 rounded-lg sm:rounded-xl p-3 sm:p-4 flex items-center justify-between border border-slate-700"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="text-xl sm:text-2xl">{p.logo}</div>
                <div className="text-base sm:text-lg">{p.name}</div>
              </div>
              <div className="text-slate-400">›</div>
            </button>
          ))}
        </div>
        <div className="mt-4 sm:mt-6">
          <button className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-800 rounded text-xs sm:text-sm" onClick={() => setCurrentPage('welcome')}>Back</button>
        </div>
      </div>
    </div>
  )

  const renderDepositConfirm = () => {
    const info = providerToAccount[selectedProvider] || { account: '—', name: '—' }
    return (
      <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div className="w-full max-w-3xl space-y-3 sm:space-y-4">
          <div className="text-xl sm:text-2xl font-bold">Confirm payment</div>
          <div>
            <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">Deposit account</div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-700">
              <div className="text-sm sm:text-lg font-mono break-all">{info.account}</div>
              <div className="text-xs sm:text-sm text-slate-400 mt-1">{info.name} ({selectedProvider === 'awash' ? 'Awash Bank' : ''})</div>
            </div>
          </div>
          <div className="space-y-2 sm:space-y-3">
            <div>
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">Amount to deposit</div>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Enter amount in Birr"
                className="w-full bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-700 outline-none text-sm sm:text-base"
              />
            </div>
            <div className="space-y-1 sm:space-y-2">
              <div className="text-xs sm:text-sm text-slate-300">Paste your deposit confirmation message</div>
              <textarea
                value={depositMessage}
                onChange={(e) => setDepositMessage(e.target.value)}
                placeholder="Paste the SMS or confirmation message you received after depositing to the account above. The message should include: amount, account number, and transaction ID."
                rows={4}
                className="w-full bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-700 outline-none resize-none text-xs sm:text-sm"
              />
            </div>
            <button
              className="w-full py-2 sm:py-3 rounded-lg sm:rounded-xl bg-emerald-600 text-black font-bold text-sm sm:text-base disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!depositAmount || !depositMessage.trim() || depositVerifying}
              onClick={async () => {
                const amountNum = Number(depositAmount)
                if (!Number.isFinite(amountNum) || amountNum <= 0) {
                  alert('Enter a valid amount')
                  return
                }
                if (!depositMessage.trim()) {
                  alert('Please paste your deposit confirmation message')
                  return
                }
                
                setDepositVerifying(true)
                try {
                  // Client-side verification
                  const verification = await verifyDepositMessage(
                    depositMessage,
                    amountNum,
                    info.account,
                    info.name
                  )
                  
                  if (!verification.valid) {
                    alert(verification.reason || 'Verification failed')
                    setDepositVerifying(false)
                    return
                  }
                  
                  // Send to server for final verification and processing
                  const response = await fetch(`${getApiUrl()}/api/deposit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userId,
                      amount: amountNum,
                      provider: selectedProvider,
                      account: info.account,
                      accountName: info.name,
                      message: depositMessage,
                      transactionId: verification.transactionId,
                    }),
                  })
                  
                  const result = await response.json()
                  
                  if (!result.success) {
                    alert(result.error || 'Deposit verification failed')
                    setDepositVerifying(false)
                    return
                  }
                  
                  // Success: balance will be updated via balance_update event from server
                  setDepositAmount('')
                  setDepositMessage('')
                  setCurrentPage('welcome')
                  alert('Deposit verified and processed successfully!')
                } catch (e: any) {
                  alert(e?.message || 'Failed to verify deposit. Please try again.')
                } finally {
                  setDepositVerifying(false)
                }
              }}
            >
              {depositVerifying ? 'Verifying…' : 'Verify & Submit Deposit'}
            </button>
          </div>
          <div className="mt-4 sm:mt-6">
            <div className="text-lg sm:text-xl font-semibold mb-1 sm:mb-2">How to deposit</div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 text-slate-300 text-xs sm:text-sm space-y-1 sm:space-y-2">
              <p>1. Send the exact amount ({depositAmount || '___'} Birr) to the account above using {selectedProvider}.</p>
              <p>2. After the deposit is successful, you will receive a confirmation SMS/message.</p>
              <p>3. Copy and paste the entire confirmation message in the text area above.</p>
              <p>4. Click "Verify & Submit Deposit" to instantly verify and process your deposit.</p>
              <p className="text-amber-400 mt-1 sm:mt-2">The system will automatically verify: amount, account number, and transaction ID. Account holder name is optional.</p>
            </div>
          </div>
          <div>
            <button className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-800 rounded text-xs sm:text-sm" onClick={() => setCurrentPage('depositSelect')}>Back</button>
          </div>
        </div>
      </div>
    )
  }


  const renderGamePage = () => {
    const recentlyCalled = called.slice(-6).reverse()
    const previousFive = recentlyCalled.filter(n => n !== lastCalled).slice(0, 5)
    const lastCallColors: Record<string, string> = {
      B: 'bg-blue-600',
      I: 'bg-pink-600',
      N: 'bg-purple-600',
      G: 'bg-green-600',
      O: 'bg-orange-500',
    }
    
    return (
      // We use h-screen and flex-col to lock the height to exactly the phone screen
      <div className="h-screen bg-slate-900 text-white flex flex-col p-2 sm:p-4 overflow-hidden">
        <div className="w-full max-w-7xl mx-auto h-full flex flex-col">
          
          {/* 1. TOP BAR */}
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => {
                const previousStake = currentBetHouse
                socket?.emit('leave_current_game')
                setPicks([])
                setMarkedNumbers(new Set())
                setIsReady(false)
                setIsWaiting(false)
                setTakenBoards([])
                setPhase('lobby')
                if (previousStake) {
                  setCurrentBetHouse(previousStake); setStake(previousStake); setCurrentPage('lobby')
                } else {
                  setCurrentPage('welcome')
                }
              }}
              className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs sm:text-sm"
            >
              Close
            </button>
          </div>
  
          {/* 2. STATS BOXES */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-orange-500 rounded-lg p-2 sm:p-4">
              <div className="text-[10px] opacity-90">Stake</div>
              <div className="text-sm sm:text-2xl font-bold">{stake} Birr</div>
            </div>
            <div className="bg-blue-600 rounded-lg p-2 sm:p-4">
              <div className="text-[10px] opacity-90">Players</div>
              <div className="text-sm sm:text-2xl font-bold">{players}</div>
            </div>
            <div className="bg-green-600 rounded-lg p-2 sm:p-4">
              <div className="text-[10px] opacity-90">Prize</div>
              <div className="text-sm sm:text-2xl font-bold">{prize} Birr</div>
            </div>
          </div>
  
          {/* CURRENT CALL STRIP */}
          {lastCalled && (
            <div className="mb-3">
              <div className="w-full bg-slate-800/80 rounded-2xl px-3 sm:px-5 py-2 sm:py-3 border border-white/10 flex items-center justify-between gap-3 sm:gap-6">
                <div className="flex-1 text-[10px] sm:text-xs text-slate-200 uppercase tracking-wide">
                  CURRENT CALL
                  <div className="mt-0.5 text-[9px] sm:text-xs text-slate-400">
                    {numberToLetter(lastCalled)} {numberToWord(lastCalled)}
                  </div>
                  {phase === 'calling' && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2 py-0.5 text-[9px] sm:text-xs text-emerald-300 border border-emerald-500/40">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Next call in {String(callCountdown).padStart(2, '0')}s</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-center">
                  <div className="h-14 w-14 sm:h-20 sm:w-20 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 text-black flex flex-col items-center justify-center font-black text-base sm:text-2xl shadow-[0_0_22px_rgba(251,146,60,0.9)] animate-pulse">
                    <div className="text-[10px] sm:text-xs tracking-wide">
                      {numberToLetter(lastCalled)}
                    </div>
                    <div>{lastCalled}</div>
                  </div>
                </div>
                <div className="flex-1 flex flex-col items-end">
                  <div className="text-[9px] sm:text-xs text-slate-300 uppercase tracking-wide mb-1">
                    LAST 5 CALLED
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {previousFive.map(n => {
                      const letter = numberToLetter(n)
                      const color = lastCallColors[letter] ?? 'bg-slate-900/80'
                      return (
                        <div
                          key={n}
                          className={`${color} px-1.5 py-0.5 rounded-full border border-white/20 text-[9px] sm:text-xs text-white shadow-sm`}
                        >
                          {letter} {n}
                        </div>
                      )
                    })}
                    {previousFive.length === 0 && (
                      <div className="px-1.5 py-0.5 rounded-full bg-slate-900/40 border border-white/5 text-[9px] sm:text-xs text-slate-500">
                        Waiting…
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. MAIN GAME AREA (Caller & Boards) */}
          {/* flex-1 and min-h-0 are key to keeping the Bingo button at the bottom */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6 flex-1 min-h-0 mb-2">
            
            {/* LEFT: Caller Board */}
            <div className="lg:col-span-2 bg-slate-800 rounded-2xl p-3 sm:p-5 flex flex-col min-h-0 shadow-2xl border border-white/5">
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-xl font-black text-white tracking-tight">LIVE CALLER</h2>
                  <button
                    type="button"
                    onClick={() => setAudioOn(prev => !prev)}
                    className="h-7 w-7 sm:h-8 sm:w-8 flex items-center justify-center rounded-full bg-slate-700 hover:bg-slate-600 text-xs sm:text-sm"
                    aria-label={audioOn ? 'Turn sound off' : 'Turn sound on'}
                  >
                    {audioOn ? '🔊' : '🔈'}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  {phase !== 'calling' && (
                    <div className="px-2 py-1 rounded bg-slate-700 font-mono text-[10px] sm:text-sm">
                      {String(seconds).padStart(2, '0')}s
                    </div>
                  )}
                </div>
              </div>
  
              <div className="flex-1 overflow-y-auto">
                <div className="text-[10px] sm:text-sm text-slate-300 mb-1">Caller Grid:</div>
                {renderCallerGrid(lastCalled ?? undefined)}
              </div>
  
              {/* Desktop Bingo Controls */}
              <div className="hidden lg:flex items-center gap-3 mt-4">
                <button
                  onClick={() => setAutoBingo(prev => !prev)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
                    autoBingo
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                      : 'bg-slate-700 border-slate-500 text-slate-200'
                  }`}
                >
                  Auto Bingo: {autoBingo ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => onPressBingo()}
                  disabled={autoAlgoMark ? false : !canBingo}
                  className={`flex-1 py-3 rounded text-lg font-bold ${
                    autoAlgoMark || canBingo ? 'bg-fuchsia-500 text-black' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  BINGO!
                </button>
              </div>
            </div>
  
            {/* RIGHT: Player Boards (Stacked & Scrollable) */}
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-4 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs sm:text-sm font-semibold">Your Boards</div>
                <div className="text-[10px] text-slate-400">{picks.length}/2</div>
              </div>
  
              {/* This div allows boards to scroll if they are too long */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {picks.map((boardId) => (
                  <div key={boardId} className="bg-slate-700 rounded-lg p-2">
                    <div className="text-[10px] sm:text-sm text-slate-300 mb-1">Board {boardId}</div>
                    {renderCard(boardId, true)}
                  </div>
                ))}
              </div>
              
              <div className="mt-2 hidden sm:block text-[10px] text-slate-400 leading-tight">
                Tap called numbers to mark. FREE is auto-marked.
              </div>
            </div>
          </div>
  
          {/* 4. MOBILE BINGO BUTTONS (Fixed at very bottom) */}
          <div className="lg:hidden pb-1 space-y-2">
            <button
              onClick={() => setAutoBingo(prev => !prev)}
              className={`w-full py-2 rounded-lg text-sm font-semibold border ${
                autoBingo
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-slate-800 border-slate-500 text-slate-200'
              }`}
            >
              Auto Bingo: {autoBingo ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => onPressBingo()}
              disabled={autoAlgoMark ? false : !canBingo}
              className={`w-full py-4 rounded-xl text-lg font-black shadow-2xl transition-transform active:scale-95 ${
                autoAlgoMark || canBingo
                  ? 'bg-fuchsia-500 text-black animate-pulse'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              BINGO!
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderWithdrawalPage = () => {
    if (currentWithdrawalPage === 'confirm') {
      return (
        <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-3xl space-y-3 sm:space-y-4">
            <div className="text-xl sm:text-2xl font-bold">Confirm Withdrawal</div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-700">
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">Withdrawal Amount</div>
              <div className="text-xl sm:text-2xl font-bold">{withdrawalAmount} Birr</div>
            </div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-700">
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">Your Account</div>
              <div className="text-sm sm:text-lg font-mono break-all">{withdrawalAccount}</div>
            </div>
            <div className="space-y-1 sm:space-y-2">
              <div className="text-xs sm:text-sm text-slate-300">Paste withdrawal confirmation message</div>
              <textarea
                value={withdrawalMessage}
                onChange={(e) => setWithdrawalMessage(e.target.value)}
                placeholder="After we process your withdrawal, you will receive a confirmation message. Paste it here to verify the withdrawal was successful."
                rows={4}
                className="w-full bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-700 outline-none resize-none text-xs sm:text-sm"
              />
            </div>
            <button
              className="w-full py-2 sm:py-3 rounded-lg sm:rounded-xl bg-blue-600 text-white font-bold text-sm sm:text-base disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!withdrawalMessage.trim() || withdrawalVerifying}
              onClick={async () => {
                if (!withdrawalMessage.trim()) {
                  alert('Please paste your withdrawal confirmation message')
                  return
                }
                
                setWithdrawalVerifying(true)
                try {
                  const amountNum = Number(withdrawalAmount)
                  
                  // Verify the message contains the withdrawal amount
                  const detectedAmount = parseAmount(withdrawalMessage)
                  if (!detectedAmount || Math.abs(detectedAmount - amountNum) > 0.01) {
                    alert('Amount in confirmation message does not match withdrawal amount')
                    setWithdrawalVerifying(false)
                    return
                  }
                  
                  // Extract transaction ID
                  const transactionId = parseTransactionId(withdrawalMessage)
                  if (!transactionId) {
                    alert('Transaction ID not found in confirmation message')
                    setWithdrawalVerifying(false)
                    return
                  }
                  
                  // Send to server for verification
                  const response = await fetch(`${getApiUrl()}/api/withdrawal/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userId,
                      amount: amountNum,
                      account: withdrawalAccount,
                      message: withdrawalMessage,
                      transactionId,
                    }),
                  })
                  
                  const result = await response.json()
                  
                  if (!result.success) {
                    alert(result.error || 'Withdrawal verification failed')
                    setWithdrawalVerifying(false)
                    return
                  }
                  
                  alert('Withdrawal verified successfully!')
                  setWithdrawalAmount('')
                  setWithdrawalAccount('')
                  setWithdrawalMessage('')
                  setCurrentWithdrawalPage('form')
                  setCurrentPage('welcome')
                } catch (e: any) {
                  alert(e?.message || 'Failed to verify withdrawal')
                } finally {
                  setWithdrawalVerifying(false)
                }
              }}
            >
              {withdrawalVerifying ? 'Verifying…' : 'Verify Withdrawal'}
            </button>
            <div>
              <button className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-800 rounded text-xs sm:text-sm" onClick={() => setCurrentWithdrawalPage('form')}>Back</button>
            </div>
          </div>
        </div>
      )
    }
    
    return (
      <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div className="w-full max-w-3xl space-y-3 sm:space-y-4">
          <div className="text-xl sm:text-2xl font-bold">Withdraw Funds</div>
          <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-700">
            <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">Available Balance</div>
            <div className="text-2xl sm:text-3xl font-bold">{balance} Birr</div>
          </div>
          <div className="space-y-2 sm:space-y-3">
            <div>
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">Withdrawal Amount</div>
              <input
                type="number"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
                placeholder="Enter amount in Birr"
                className="w-full bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-700 outline-none text-sm sm:text-base"
              />
            </div>
            <div>
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">Your Account Number</div>
              <input
                type="text"
                value={withdrawalAccount}
                onChange={(e) => setWithdrawalAccount(e.target.value)}
                placeholder="Enter your account number (same bank/provider as deposit)"
                className="w-full bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-700 outline-none text-sm sm:text-base"
              />
            </div>
            <button
              className="w-full py-2 sm:py-3 rounded-lg sm:rounded-xl bg-blue-600 text-white font-bold text-sm sm:text-base disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={!withdrawalAmount || !withdrawalAccount.trim() || withdrawalVerifying}
              onClick={async () => {
                const amountNum = Number(withdrawalAmount)
                if (!Number.isFinite(amountNum) || amountNum <= 0) {
                  alert('Enter a valid amount')
                  return
                }
                if (amountNum > balance) {
                  alert('Insufficient balance')
                  return
                }
                if (!withdrawalAccount.trim()) {
                  alert('Enter your account number')
                  return
                }
                
                setWithdrawalVerifying(true)
                try {
                  const response = await fetch(`${getApiUrl()}/api/withdrawal`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userId,
                      amount: amountNum,
                      account: withdrawalAccount,
                    }),
                  })
                  
                  const result = await response.json()
                  
                  if (!result.success) {
                    alert(result.error || 'Withdrawal request failed')
                    setWithdrawalVerifying(false)
                    return
                  }
                  
                  // Balance will be updated via balance_update event from server
                  // Move to confirmation page
                  setCurrentWithdrawalPage('confirm')
                  alert('Withdrawal request submitted! Please check your account and paste the confirmation message.')
                } catch (e: any) {
                  alert(e?.message || 'Failed to process withdrawal request')
                } finally {
                  setWithdrawalVerifying(false)
                }
              }}
            >
              {withdrawalVerifying ? 'Processing…' : 'Request Withdrawal'}
            </button>
          </div>
          <div className="mt-4 sm:mt-6">
            <div className="text-lg sm:text-xl font-semibold mb-1 sm:mb-2">How to withdraw</div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 text-slate-300 text-xs sm:text-sm space-y-1 sm:space-y-2">
              <p>1. Enter the amount you want to withdraw (must be less than or equal to your balance).</p>
              <p>2. Enter your account number where you want to receive the funds.</p>
              <p>3. Click "Request Withdrawal" to submit your request.</p>
              <p>4. After we process your withdrawal, you will receive a confirmation message.</p>
              <p>5. Paste the confirmation message to verify the withdrawal was successful.</p>
            </div>
          </div>
          <div>
            <button className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-800 rounded text-xs sm:text-sm" onClick={() => setCurrentPage('welcome')}>Back</button>
          </div>
        </div>
      </div>
    )
  }

  // Redirect to login if not authenticated (except for login page)
  if (!isAuthenticated && currentPage !== 'login') {
    return renderLoginPage()
  }

  const mainPage =
    currentPage === 'login' ? renderLoginPage()
    : currentPage === 'welcome' ? renderWelcomePage()
    : currentPage === 'instructions' ? renderInstructionsPage()
    : currentPage === 'depositSelect' ? renderDepositSelect()
    : currentPage === 'depositConfirm' ? renderDepositConfirm()
    : currentPage === 'withdrawal' ? renderWithdrawalPage()
    : currentPage === 'lobby' ? renderLobbyPage()
    : renderGamePage()

  return (
    <>
      {mainPage}
      {winnerInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-emerald-400/40 shadow-2xl p-4 sm:p-6 space-y-4">
            <div className="text-xl sm:text-2xl font-bold text-emerald-300 text-center">
              Winner!
            </div>
            
            {/* 🔧 FIXED: Only show the winning board with highlighted line */}
            {winnerInfo.boardId ? (
              <div className="space-y-2">
                <div className="text-sm text-slate-300 text-center">
                  Board {winnerInfo.boardId}
                </div>
                {renderCard(winnerInfo.boardId, true, winnerInfo.lineIndices || [])}
              </div>
            ) : (
              <div className="text-center text-slate-400 text-sm">
                Winning board data unavailable
              </div>
            )}
            
            <div className="flex justify-center pt-2">
              <button
                onClick={() => setWinnerInfo(null)}
                className="px-6 py-2 rounded-lg bg-emerald-500 text-black font-semibold text-sm sm:text-base"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}