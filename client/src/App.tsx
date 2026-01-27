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
  const [boardHtmlProvided, setBoardHtmlProvided] = useState<boolean>(false)
  const [currentPage, setCurrentPage] = useState<Page>('login')
  const [isReady, setIsReady] = useState<boolean>(false)
  const [markedNumbers, setMarkedNumbers] = useState<Set<number>>(new Set())
  const [callCountdown, setCallCountdown] = useState<number>(0)
  const [lastCalled, setLastCalled] = useState<number | null>(null)
  const [autoMark, setAutoMark] = useState<boolean>(false)
  const [autoAlgoMark, setAutoAlgoMark] = useState<boolean>(false)
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
      transports: ['websocket'],
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
        setTakenBoards([])
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

    // Number calls for the current room (socket is only in one room)
    s.on('call', (d: any) => {
      setCalled(d.called)
      setLastCalled(d.number)
      setCallCountdown(3)
      if (autoMark || autoAlgoMark) {
        setMarkedNumbers(prev => {
          const next = new Set(prev)
          next.add(d.number)
          return next
        })
      }
      // Only play audio for active players in the current live game
      if (audioOn && !isWaiting && phase === 'calling') {
        playCallSound(d.number)
      }
    })
    
    s.on('winner', (d: any) => { 
      alert(`Winner: ${d.playerId}\nPrize: ${d.prize}`)
      setPicks([])
      setMarkedNumbers(new Set())
      setCurrentPage('lobby')
      setIsReady(false)
      setIsWaiting(false)
    })
    
    s.on('game_start', () => {
      if (!isWaiting) {
        setCurrentPage('game')
      }
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


  // Manage 3s per-call countdown lifecycle
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

  // Ensure a win line exists that includes the most recent called number
  const hasBingoIncludingLastCalled = (): boolean => {
    if (!lastCalled) return false
    // Effective marked set: when auto algorithm is on, use called numbers as marks
    const effectiveMarks = new Set<number>(autoAlgoMark ? called : Array.from(markedNumbers))
    for (const boardId of picks) {
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
        const containsLast = line.includes(lastCalled)
        if (!containsLast) continue
        const complete = line.every(n => n === -1 || effectiveMarks.has(n))
        if (complete) return true
      }
    }
    return false
  }

  const onPressBingo = () => {
    if (phase !== 'calling' || isWaiting) return
    // Validate locally before notifying server
    if (!hasBingoIncludingLastCalled()) {
      alert('No valid BINGO found that includes the last called number. Keep marking!')
      return
    }
    if (!currentBetHouse) return
    socket?.emit('bingo', { stake: currentBetHouse })
  }

  // Render 75-number caller grid with B I N G O columns
  const renderCallerGrid = () => {
    // Build columns: B(1-15), I(16-30), N(31-45), G(46-60), O(61-75)
    const columns: number[][] = [
      Array.from({ length: 15 }, (_, i) => i + 1),
      Array.from({ length: 15 }, (_, i) => i + 16),
      Array.from({ length: 15 }, (_, i) => i + 31),
      Array.from({ length: 15 }, (_, i) => i + 46),
      Array.from({ length: 15 }, (_, i) => i + 61),
    ]

    const headers = ['B', 'I', 'N', 'G', 'O']
    const headerColors = ['bg-blue-500', 'bg-pink-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500']

    return (
      <div className="w-full">
        <div className="grid grid-cols-5 gap-1 mb-2">
          {headers.map((h, idx) => (
            <div key={h} className={`${headerColors[idx]} rounded text-center font-bold text-white py-1 text-xs sm:text-sm`}>
              {h}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {columns.map((col, cIdx) => (
            <div key={cIdx} className="grid grid-rows-15 gap-1">
              {col.map((n) => {
                const isCalled = called.includes(n)
                return (
                  <div
                    key={n}
                    className={[
                      'h-5 sm:h-6 md:h-7 w-full rounded text-[10px] sm:text-xs md:text-sm flex items-center justify-center border',
                      isCalled ? 'bg-emerald-500 border-emerald-400 text-black font-semibold' : 'bg-slate-700 border-slate-600 text-slate-300'
                    ].join(' ')}
                  >
                    {n}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Audio: try to play a sound for each call using selected pack
  const numberToLetter = (n: number) => (n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O')

  // Cache audio elements so calls play instantly after first load
  const audioCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map())
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

  const renderCard = (boardId: number | null, isGamePage: boolean = false) => {
    if (!boardId) return null
    const grid: BoardGrid | null = getBoard(boardId)
    if (!grid) return (
      <div className="text-slate-400">Board {boardId} not found</div>
    )
    
    // Check if this board can form a bingo
    const boardCanBingo = isGamePage ? checkBingo(grid) : false
    
    const headers = ['B', 'I', 'N', 'G', 'O']
    const headerColors = ['bg-blue-500', 'bg-pink-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500']
    
    return (
      <div className="w-full">
        {/* Colored BINGO headers */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {headers.map((h, idx) => (
            <div key={h} className={`${headerColors[idx]} rounded text-center font-bold text-white py-1 text-xs sm:text-sm`}>
              {h}
            </div>
          ))}
        </div>
      <div className="grid grid-cols-5 gap-1">
        {grid.map((val, idx) => {
          const isFree = val === -1
          const isMarked = isFree || markedNumbers.has(val)
          const isCalled = called.includes(val)
          const shouldHighlight = isGamePage 
            ? (autoAlgoMark ? (isFree || isCalled) : isMarked)
            : isCalled
            // Show star if marked and can form bingo
            const showStar = isGamePage && boardCanBingo && isMarked && !isFree

  return (
            <div 
              key={idx} 
              onClick={() => isGamePage && !isFree && isCalled && toggleMark(val)}
              className={[
                  'aspect-square rounded text-xs sm:text-sm flex items-center justify-center border cursor-pointer relative',
                  shouldHighlight ? 'bg-emerald-500 border-emerald-400 text-black font-semibold' : 'bg-slate-700 border-slate-600 text-slate-200',
                isGamePage && !isFree && isCalled ? 'hover:brightness-110' : ''
              ].join(' ')}
            >
                {isFree ? (
                  <span className="text-emerald-300 font-bold text-[10px] sm:text-xs">FREE</span>
                ) : (
                  <>
                    <span>{val}</span>
                    {showStar && (
                      <span className="absolute -top-1 -left-1 text-green-400 text-lg">★</span>
                    )}
                  </>
                )}
            </div>
          )
        })}
        </div>
      </div>
    )
  }

  const renderLobbyPage = () => (
    <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="bg-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="text-slate-300 text-sm">ID: <span className="font-mono">{playerId.slice(0,8)}</span></div>
            <div className="flex gap-4 text-sm">
              <span>Stake: <b>{stake} Birr</b></span>
              <span>Active: <b>{players}</b></span>
              {waitingPlayers > 0 && <span>Waiting: <b>{waitingPlayers}</b></span>}
              <span>Prize: <b>{prize} Birr</b></span>
            </div>
          </div>
          
          <div className="flex items-center justify-between mb-6">
            <div className="text-2xl font-bold">
              Select Your Boards
              {isWaiting && (
                <span className="ml-3 px-3 py-1 rounded bg-yellow-500 text-black text-sm font-bold">
                  Waiting for next game...
                </span>
              )}
            </div>
            {!isWaiting && (
            <div className="px-4 py-2 rounded bg-slate-700 font-mono text-lg">
              {String(seconds).padStart(2,"0")}s
            </div>
            )}
            {isWaiting && (
              <div className="px-4 py-2 rounded bg-yellow-500/20 text-yellow-400 font-mono text-sm">
                Game in progress
              </div>
            )}
          </div>

          {/* Audio and Auto Mark toggles visible before countdown */}
          <div className="flex flex-wrap items-center gap-6 mb-6">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-300">Audio:</span>
              <select
                className="bg-slate-700 text-slate-100 rounded px-2 py-1"
                value={audioPack}
                onChange={(e) => setAudioPack(e.target.value)}
              >
                <option value="amharic">Amharic</option>
                <option value="modern-amharic">Modern Amharic</option>
              </select>
              <input type="checkbox" checked={audioOn} onChange={(e) => setAudioOn(e.target.checked)} />
              <button
                className="ml-2 px-2 py-1 rounded bg-slate-700 hover:brightness-110"
                onClick={() => playCallSound(1)}
              >
                Test
              </button>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoMark}
                onChange={(e) => setAutoMark(e.target.checked)}
              />
              <span className="text-slate-300">Auto mark (me)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoAlgoMark}
                onChange={(e) => setAutoAlgoMark(e.target.checked)}
              />
              <span className="text-slate-300">Auto algorithm mark</span>
            </label>
          </div>
          
          <div className="grid grid-cols-10 gap-2 mb-6">
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
            <div className="mb-6">
              <div className="text-slate-300 mb-4">Your Selected Boards ({picks.length}/2):</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {picks.map((boardId, idx) => (
                  <div key={boardId} className="bg-slate-700 rounded-lg p-4">
                    <div className="text-sm text-slate-400 mb-2">Board {boardId}</div>
                    {renderCard(boardId, false)}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <div className="text-slate-300">
              Selected: {picks.length}/2 boards
              {isWaiting && picks.length > 0 && (
                <div className="mt-2 text-yellow-400 text-sm">
                  You'll join the next game when it starts
                </div>
              )}
              {picks.length > 0 && !isWaiting && (
                <div className="flex gap-2 mt-2">
                  {picks.map(n => (
                    <span key={n} className="px-2 py-1 bg-amber-500 text-black rounded text-sm">Board {n}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                onClick={() => setCurrentPage('welcome')}
              >
                Switch Bet House
              </button>
            <button
              onClick={handleStartGame}
              disabled={picks.length === 0 || isReady}
              className={`px-6 py-3 rounded-lg font-bold text-lg ${
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
    <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-800 rounded-xl p-8 space-y-6">
          <div className="text-center">
            <div className="text-3xl font-bold mb-2">WIN BINGO</div>
            <div className="text-slate-400 text-sm">Welcome! Please sign in or create an account</div>
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

          <div className="space-y-4">
            <div>
              <label className="text-slate-300 text-sm mb-2 block">Username</label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full bg-slate-700 rounded-lg p-3 border border-slate-600 outline-none focus:border-emerald-500"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !loginLoading) {
                    if (loginMode === 'login') handleLogin()
                    else handleSignup()
                  }
                }}
              />
            </div>
            <div>
              <label className="text-slate-300 text-sm mb-2 block">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full bg-slate-700 rounded-lg p-3 border border-slate-600 outline-none focus:border-emerald-500"
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
              className="w-full py-3 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700"
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
    <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold">Hello, {username}!</div>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 rounded bg-amber-500 text-black font-semibold"
              onClick={() => setCurrentPage('depositSelect')}
            >
              + Deposit
            </button>
            <button
              className="px-4 py-2 rounded bg-blue-500 text-white font-semibold"
              onClick={() => setCurrentPage('withdrawal')}
            >
              Withdraw
            </button>
            <button
              className="px-4 py-2 rounded bg-slate-700 text-white font-semibold"
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </div>

        {/* Balance card */}
        <div className="bg-rose-500/80 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="uppercase text-xs">Balance</div>
            <div className="text-3xl font-extrabold">{balance} Birr</div>
            <div className="mt-2 text-xs opacity-90">Bonus</div>
            <div className="text-lg font-bold">{bonus} Birr</div>
          </div>
          <div className="text-6xl font-black opacity-60">ETB</div>
        </div>

        <div className="flex items-center justify-between">
          <button
            className="px-4 py-3 rounded bg-slate-800 hover:bg-slate-700"
            onClick={() => setCurrentPage('instructions')}
          >
            Instructions
          </button>
          <button
            className="px-4 py-3 rounded bg-slate-800 hover:bg-slate-700"
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/?ref=${playerId}`)}
          >
            Invite Friends (copy link)
          </button>
        </div>

        <div className="text-xl font-semibold">Bet Houses</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <div key={house.stake} className={`${config.color} rounded-xl p-5 flex flex-col gap-4 ${isSelected ? 'ring-4 ring-yellow-400' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm opacity-90">{config.label}</div>
                  {isLive && <span className="px-2 py-1 rounded bg-red-500 text-xs font-bold animate-pulse">LIVE</span>}
                  {isCountdown && <span className="px-2 py-1 rounded bg-yellow-500 text-xs font-bold">Starting</span>}
                </div>
                <div className="text-3xl font-extrabold">{house.stake} Birr</div>
                <div className="text-sm opacity-90">
                  <div>Active: {house.activePlayers} players</div>
                  {house.waitingPlayers > 0 && <div>Waiting: {house.waitingPlayers} players</div>}
                  <div>Prize: {house.prize} Birr</div>
                </div>
              <div className="mt-auto flex items-center justify-between">
                <button
                    className="px-4 py-2 rounded bg-black/30 hover:bg-black/40 font-semibold"
                  onClick={() => {
                      handleJoinBetHouse(house.stake)
                    setCurrentPage('lobby')
                  }}
                >
                    {isSelected ? 'Go to Lobby' : isLive ? 'Join & Wait' : 'Play now'}
                </button>
                  <div className="h-12 w-12 rounded-full bg-black/20 flex items-center justify-center text-xl font-black">{config.tag}</div>
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
                <div key={amount} className={`${config.color} rounded-xl p-5 flex flex-col gap-4`}>
                  <div className="text-sm opacity-90">{config.label}</div>
                  <div className="text-3xl font-extrabold">{amount} Birr</div>
            <div className="mt-auto flex items-center justify-between">
              <button
                className="px-4 py-2 rounded bg-black/30 hover:bg-black/40"
                onClick={() => {
                        handleJoinBetHouse(amount)
                  setCurrentPage('lobby')
                }}
              >
                Play now
              </button>
                    <div className="h-12 w-12 rounded-full bg-black/20 flex items-center justify-center text-xl font-black">{config.tag}</div>
            </div>
          </div>
              )
            })
          )}
        </div>

        <div className="text-xs text-slate-400">Version preview</div>
      </div>
    </div>
  )

  const renderInstructionsPage = () => (
    <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-slate-800 rounded-xl p-6 space-y-4">
        <div className="text-2xl font-bold mb-2">How to play</div>
        <ol className="list-decimal space-y-2 ml-5 text-slate-200 text-sm">
          <li>Choose a bet house (10/20/50/100/200 Birr).</li>
          <li>Select up to 2 boards in the lobby.</li>
          <li>Press Start Game to enter the live game.</li>
          <li>During calling, mark called numbers on your boards or enable auto mark.</li>
          <li>Press BINGO only when a full row/column/diagonal is complete including the last call.</li>
        </ol>
        <div className="text-2xl font-bold mt-6">Deposits & Withdrawals</div>
        <p className="text-slate-200 text-sm">Use the Deposit button on the Welcome page. Withdrawal flow can be added similarly.</p>
        <div className="flex justify-end">
          <button className="px-4 py-2 rounded bg-slate-700" onClick={() => setCurrentPage('welcome')}>Back</button>
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
    <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="text-2xl font-bold mb-4">Select Payment Platform</div>
        <div className="bg-emerald-600/80 rounded-lg px-4 py-2 text-sm mb-3">Recommended</div>
        <div className="space-y-3">
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelectedProvider(p.id); setCurrentPage('depositConfirm') }}
              className="w-full bg-slate-800 hover:bg-slate-700 rounded-xl p-4 flex items-center justify-between border border-slate-700"
            >
              <div className="flex items-center gap-3">
                <div className="text-2xl">{p.logo}</div>
                <div className="text-lg">{p.name}</div>
              </div>
              <div className="text-slate-400">›</div>
            </button>
          ))}
        </div>
        <div className="mt-6">
          <button className="px-4 py-2 bg-slate-800 rounded" onClick={() => setCurrentPage('welcome')}>Back</button>
        </div>
      </div>
    </div>
  )

  const renderDepositConfirm = () => {
    const info = providerToAccount[selectedProvider] || { account: '—', name: '—' }
    return (
      <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-3xl space-y-4">
          <div className="text-2xl font-bold">Confirm payment</div>
          <div>
            <div className="text-slate-300 text-sm mb-2">Deposit account</div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="text-lg font-mono">{info.account}</div>
              <div className="text-sm text-slate-400 mt-1">{info.name} ({selectedProvider === 'awash' ? 'Awash Bank' : ''})</div>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-slate-300 text-sm mb-2">Amount to deposit</div>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Enter amount in Birr"
                className="w-full bg-slate-800 rounded-xl p-3 border border-slate-700 outline-none"
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm text-slate-300">Paste your deposit confirmation message</div>
              <textarea
                value={depositMessage}
                onChange={(e) => setDepositMessage(e.target.value)}
                placeholder="Paste the SMS or confirmation message you received after depositing to the account above. The message should include: amount, account number, and transaction ID."
                rows={6}
                className="w-full bg-slate-800 rounded-xl p-3 border border-slate-700 outline-none resize-none"
              />
            </div>
            <button
              className="w-full py-3 rounded-xl bg-emerald-600 text-black font-bold disabled:opacity-60 disabled:cursor-not-allowed"
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
          <div className="mt-6">
            <div className="text-xl font-semibold mb-2">How to deposit</div>
            <div className="bg-slate-800 rounded-xl p-4 text-slate-300 text-sm space-y-2">
              <p>1. Send the exact amount ({depositAmount || '___'} Birr) to the account above using {selectedProvider}.</p>
              <p>2. After the deposit is successful, you will receive a confirmation SMS/message.</p>
              <p>3. Copy and paste the entire confirmation message in the text area above.</p>
              <p>4. Click "Verify & Submit Deposit" to instantly verify and process your deposit.</p>
              <p className="text-amber-400 mt-2">The system will automatically verify: amount, account number, and transaction ID. Account holder name is optional.</p>
            </div>
          </div>
          <div>
            <button className="px-4 py-2 bg-slate-800 rounded" onClick={() => setCurrentPage('depositSelect')}>Back</button>
          </div>
        </div>
      </div>
    )
  }


  const renderGamePage = () => {
    // Get last 5 called numbers for recently called display
    const recentlyCalled = called.slice(-5).reverse()
    
    return (
      <div className="min-h-screen bg-slate-900 text-white p-2 sm:p-4">
        <div className="w-full max-w-7xl mx-auto">
          {/* Top bar with Close button */}
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <button
              onClick={() => {
                // Leave the current game on the server and return to welcome page
                const previousStake = currentBetHouse
                socket?.emit('leave_current_game')
                setPicks([])
                setMarkedNumbers(new Set())
                setIsReady(false)
                setIsWaiting(false)
                setTakenBoards([])
                setPhase('lobby')
                // Return to the same bet house's selecting page if we know it
                if (previousStake) {
                  setCurrentBetHouse(previousStake)
                  setStake(previousStake)
                  setCurrentPage('lobby')
                } else {
                  setCurrentPage('welcome')
                }
              }}
              className="px-3 py-1 sm:px-4 sm:py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs sm:text-sm"
            >
              Close
            </button>
          </div>
          {/* Info Boxes: Stake, Players, Prize */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-3 sm:mb-4">
            {/* Stake Box - Orange */}
            <div className="bg-orange-500 rounded-lg sm:rounded-xl p-2 sm:p-4">
              <div className="text-[10px] sm:text-xs opacity-90 mb-1">Stake</div>
              <div className="text-lg sm:text-2xl font-bold">{stake} Birr</div>
            </div>
            
            {/* Players Box - Blue */}
            <div className="bg-blue-600 rounded-lg sm:rounded-xl p-2 sm:p-4">
              <div className="text-[10px] sm:text-xs opacity-90 mb-1">Players</div>
              <div className="text-lg sm:text-2xl font-bold">{players}</div>
          </div>
          
            {/* Prize Box - Green */}
            <div className="bg-green-600 rounded-lg sm:rounded-xl p-2 sm:p-4">
              <div className="text-[10px] sm:text-xs opacity-90 mb-1">Prize</div>
              <div className="text-lg sm:text-2xl font-bold">{prize} Birr</div>
            </div>
          </div>

          {/* Recently Called Numbers */}
          {called.length > 0 && (
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-3 mb-3 sm:mb-4">
              <div className="text-[10px] sm:text-xs text-slate-400 mb-2">Recently Called Numbers:</div>
              <div className="flex gap-1 sm:gap-2 flex-wrap">
                {recentlyCalled.map((num, idx) => {
                  const letter = num <= 15 ? 'B' : num <= 30 ? 'I' : num <= 45 ? 'N' : num <= 60 ? 'G' : 'O'
                  const colors = ['bg-green-500', 'bg-orange-500', 'bg-blue-500', 'bg-purple-500', 'bg-pink-500']
                  return (
                    <div
                      key={`${num}-${idx}`}
                      className={`${colors[idx % colors.length]} rounded px-2 sm:px-3 py-1 sm:py-2 font-bold text-[10px] sm:text-xs`}
                    >
                      {letter}-{num}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Main Layout: Caller Board (Left) and Player Boards (Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-6">
            {/* Left: Main Caller Board */}
            <div className="lg:col-span-2 bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-2 sm:mb-4">
                <div className="text-sm sm:text-lg font-semibold mb-2 sm:mb-0">Live Game</div>
            <div className="flex items-center gap-2">
                  <div className="px-2 sm:px-3 py-1 rounded bg-slate-700 font-mono text-xs sm:text-sm" title="Time until next game start">
                {String(seconds).padStart(2,"0")}s
              </div>
              {phase === 'calling' && (
                    <div className="px-2 sm:px-3 py-1 rounded bg-emerald-700 font-mono text-xs sm:text-sm" title="Next call in">
                  {String(callCountdown).padStart(2,'0')}s
                </div>
              )}
            </div>
          </div>

          {/* Big last-called number display */}
              {phase === 'calling' && lastCalled && (
                <div className="mb-3 sm:mb-4">
                  <div className="text-2xl sm:text-4xl md:text-5xl font-black tracking-wide text-center sm:text-left">
                    {`${lastCalled <= 15 ? 'B' : lastCalled <= 30 ? 'I' : lastCalled <= 45 ? 'N' : lastCalled <= 60 ? 'G' : 'O'}-${lastCalled}`}
              </div>
            </div>
          )}
          
              <div className="text-xs sm:text-sm text-slate-300 mb-2">Caller:</div>
              <div className="mb-4 overflow-x-auto">
            {renderCallerGrid()}
          </div>
          
          <button
            onClick={onPressBingo}
            disabled={autoAlgoMark ? false : !canBingo}
                className={`w-full py-2 sm:py-3 rounded text-sm sm:text-lg font-bold ${
              autoAlgoMark || canBingo
                ? 'bg-fuchsia-500 hover:brightness-110 text-black' 
                : 'bg-slate-700 text-slate-400 cursor-not-allowed'
            }`}
          >
            BINGO!
          </button>
        </div>

            {/* Right: Player Boards */}
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-4">
              <div className="text-sm sm:text-lg font-semibold mb-3 sm:mb-4">Your Boards:</div>
              <div className="space-y-4 sm:space-y-6">
            {picks.map((boardId) => (
                  <div key={boardId} className="bg-slate-700 rounded-lg p-2 sm:p-3">
                    <div className="text-xs sm:text-sm text-slate-300 mb-2">Board {boardId}</div>
                {renderCard(boardId, true)}
              </div>
            ))}
          </div>
              <div className="mt-3 sm:mt-4 text-[10px] sm:text-xs text-slate-400">
            Click on called numbers to mark them. FREE is always marked.
              </div>
          </div>
        </div>
      </div>
    </div>
  )
  }

  const renderWithdrawalPage = () => {
    if (currentWithdrawalPage === 'confirm') {
      return (
        <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
          <div className="w-full max-w-3xl space-y-4">
            <div className="text-2xl font-bold">Confirm Withdrawal</div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="text-slate-300 text-sm mb-2">Withdrawal Amount</div>
              <div className="text-2xl font-bold">{withdrawalAmount} Birr</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <div className="text-slate-300 text-sm mb-2">Your Account</div>
              <div className="text-lg font-mono">{withdrawalAccount}</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm text-slate-300">Paste withdrawal confirmation message</div>
              <textarea
                value={withdrawalMessage}
                onChange={(e) => setWithdrawalMessage(e.target.value)}
                placeholder="After we process your withdrawal, you will receive a confirmation message. Paste it here to verify the withdrawal was successful."
                rows={6}
                className="w-full bg-slate-800 rounded-xl p-3 border border-slate-700 outline-none resize-none"
              />
            </div>
            <button
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-60 disabled:cursor-not-allowed"
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
              <button className="px-4 py-2 bg-slate-800 rounded" onClick={() => setCurrentWithdrawalPage('form')}>Back</button>
            </div>
          </div>
        </div>
      )
    }
    
    return (
      <div className="min-h-full bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-3xl space-y-4">
          <div className="text-2xl font-bold">Withdraw Funds</div>
          <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="text-slate-300 text-sm mb-2">Available Balance</div>
            <div className="text-3xl font-bold">{balance} Birr</div>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-slate-300 text-sm mb-2">Withdrawal Amount</div>
              <input
                type="number"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
                placeholder="Enter amount in Birr"
                className="w-full bg-slate-800 rounded-xl p-3 border border-slate-700 outline-none"
              />
            </div>
            <div>
              <div className="text-slate-300 text-sm mb-2">Your Account Number</div>
              <input
                type="text"
                value={withdrawalAccount}
                onChange={(e) => setWithdrawalAccount(e.target.value)}
                placeholder="Enter your account number (same bank/provider as deposit)"
                className="w-full bg-slate-800 rounded-xl p-3 border border-slate-700 outline-none"
              />
            </div>
            <button
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-60 disabled:cursor-not-allowed"
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
          <div className="mt-6">
            <div className="text-xl font-semibold mb-2">How to withdraw</div>
            <div className="bg-slate-800 rounded-xl p-4 text-slate-300 text-sm space-y-2">
              <p>1. Enter the amount you want to withdraw (must be less than or equal to your balance).</p>
              <p>2. Enter your account number where you want to receive the funds.</p>
              <p>3. Click "Request Withdrawal" to submit your request.</p>
              <p>4. After we process your withdrawal, you will receive a confirmation message.</p>
              <p>5. Paste the confirmation message to verify the withdrawal was successful.</p>
            </div>
          </div>
          <div>
            <button className="px-4 py-2 bg-slate-800 rounded" onClick={() => setCurrentPage('welcome')}>Back</button>
          </div>
        </div>
      </div>
    )
  }

  // Redirect to login if not authenticated (except for login page)
  if (!isAuthenticated && currentPage !== 'login') {
    return renderLoginPage()
  }

  if (currentPage === 'login') return renderLoginPage()
  if (currentPage === 'welcome') return renderWelcomePage()
  if (currentPage === 'instructions') return renderInstructionsPage()
  if (currentPage === 'depositSelect') return renderDepositSelect()
  if (currentPage === 'depositConfirm') return renderDepositConfirm()
  if (currentPage === 'withdrawal') return renderWithdrawalPage()
  if (currentPage === 'lobby') return renderLobbyPage()
  return renderGamePage()
}