import { useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { getBoard, loadBoards, type BoardGrid } from './boards'

// Get API base URL
const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  return process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:3001'
}

type Phase = 'lobby' | 'countdown' | 'calling'
type Page = 'login' | 'welcome' | 'instructions' | 'depositSelect' | 'depositConfirm' | 'withdrawal' | 'lobby' | 'game' | 'bingoHouseSelect' | 'aviatorGamePage'
type Language = 'en' | 'am' | 'ti' | 'or'

// --- TRANSLATIONS CONFIGURATION ---
const translations = {
  en: {
    hello: 'Hello',
    back: 'Back',
    close: 'Close',
    loading: 'Processing...',
    ok: 'OK',
    signin: 'Sign In',
    signup: 'Sign Up',
    username: 'Username',
    password: 'Password',
    enter_username: 'Enter your username',
    enter_password: 'Enter your password',
    create_account: 'Create Account',
    welcome_login_msg: 'Welcome! Please sign in or create an account',
    deposit: '+ Deposit',
    withdraw: 'Withdraw',
    logout: 'Logout',
    balance: 'WALLET',
    bonus: 'BONUS',
    total_playable: 'Total Playable',
    instructions: 'Instructions',
    invite: 'Invite Friends',
    game_title_bingo: 'BINGO',
    game_title_aviator: 'Aviator',
    game_title_keno: 'KENO',
    play_now: 'Play now',
    select_bingo_house: 'Select BINGO Bet House',
    bet_houses: 'Bet Houses',
    stake: 'Stake',
    select_boards: 'Select Your Boards',
    selected: 'Selected',
    start_game: 'Start Game',
    ready: 'Ready!',
    switch_house: 'Switch Bet House',
    game_in_progress: 'Game in progress',
    current_call: 'CURRENT CALL',
    last_5: 'LAST 5 CALLED',
    live_caller: 'LIVE CALLER',
    auto_bingo: 'Auto Bingo',
    bingo_btn: 'BINGO!',
    your_boards: 'Your Boards',
    tap_mark_hint: 'Tap called numbers to mark. FREE is auto-marked.',
    next_call_in: 'Next call in',
    winner: 'Winner',
    winning_board: 'Winning Board',
    select_payment: 'Select Payment Platform',
    recommended: 'Recommended',
    confirm_payment: 'Confirm payment',
    deposit_account: 'Deposit account',
    amount_deposit: 'Amount to deposit',
    paste_deposit_msg: 'Paste your deposit confirmation message',
    verify_submit: 'Verify & Submit Deposit',
    how_to_deposit: 'How to deposit',
    verifying: 'Verifying…',
    withdraw_funds: 'Withdraw Funds',
    available_balance: 'Withdrawable Balance',
    withdraw_amount: 'Withdrawal Amount',
    your_account_num: 'Your Account Number',
    request_withdraw: 'Request Withdrawal',
    how_to_withdraw: 'How to withdraw',
    confirm_withdraw: 'Confirm Withdrawal',
    your_account: 'Your Account',
    paste_withdraw_msg: 'Paste withdrawal confirmation message',
    verify_withdraw: 'Verify Withdrawal',
    how_to_play: 'How to play',
    rule_1: 'Choose a bet house.',
    rule_2: 'Select up to 2 boards in the lobby.',
    rule_3: 'Press Start Game to enter the live game.',
    rule_4: 'During calling, mark called numbers or enable auto mark.',
    rule_5: 'Press BINGO only when a full line is complete including the last call.',
    dep_with_title: 'Deposits & Withdrawals',
    dep_with_desc: 'Use the Deposit button on the Welcome page.',
    audio: 'Audio',
    auto_mark_me: 'Auto mark (me)',
    auto_algo: 'Auto algorithm mark',
    players_label: 'Players',
    waiting: 'Waiting',
    prize: 'Prize',
    active: 'Active',
    go_lobby: 'Go to Lobby',
    join_wait: 'Join & Wait',
    insufficient_balance_msg: 'Insufficient total balance to join this bet house.',
    link_copied: 'Invite link copied!',
    first_deposit_bonus: '🎉 First Deposit Bonus: 2X!',
    referral_bonus: 'Referral Bonus',
    wallet_desc: 'Deposits + Winnings',
    bonus_desc: 'Promo + Referral'
  },
  am: {
    hello: 'ሰላም',
    back: 'ተመለስ',
    close: 'ዝጋ',
    loading: 'በማስኬድ ላይ...',
    ok: 'እሺ',
    signin: 'ግባ',
    signup: 'ተመዝገብ',
    username: 'የተጠቃሚ ስም',
    password: 'የይለፍ ቃል',
    enter_username: 'የተጠቃሚ ስም ያስገቡ',
    enter_password: 'የይለፍ ቃል ያስገቡ',
    create_account: 'መለያ ፍጠር',
    welcome_login_msg: 'እንኳን ደህና መጡ! እባክዎ ይግቡ ወይም መለያ ይፍጠሩ',
    deposit: '+ ገቢ አድርግ',
    withdraw: 'ወጪ አድርግ',
    logout: 'ውጣ',
    balance: 'ዋሌት',
    bonus: 'ቦነስ',
    total_playable: 'ጠቅላላ የሚጫወት',
    instructions: 'መመሪያዎች',
    invite: 'ጓደኛ ይጋብዙ',
    game_title_bingo: 'ቢንጎ',
    game_title_aviator: 'አቪዬተር',
    game_title_keno: 'ኬኖ',
    play_now: 'አሁን ተጫወት',
    select_bingo_house: 'የቢንጎ ውርርድ ቤት ይምረጡ',
    bet_houses: 'የውርርድ ቤቶች',
    stake: 'ውርርድ',
    select_boards: 'ካርቶዎችን ይምረጡ',
    selected: 'ተመርጧል',
    start_game: 'ጨዋታ ጀምር',
    ready: 'ዝግጁ!',
    switch_house: 'ቤት ቀይር',
    game_in_progress: 'ጨዋታ በመካሄድ ላይ',
    current_call: 'የአሁኑ ቁጥር',
    last_5: 'የመጨረሻዎቹ 5',
    live_caller: 'ቀጥታ ጠሪ',
    auto_bingo: 'ራስ-ሰር ቢንጎ',
    bingo_btn: 'ቢንጎ!',
    your_boards: 'የእርስዎ ካርቶዎች',
    tap_mark_hint: 'ቁጥሮችን ለመለየት ይንኩ። FREE በራስ-ሰር ይሞላል።',
    next_call_in: 'ቀጣይ ቁጥር በ',
    winner: 'አሸናፊ',
    winning_board: 'ያሸንፈው ካርቶ',
    select_payment: 'የክፍያ አማራጭ ይምረጡ',
    recommended: 'የሚመከር',
    confirm_payment: 'ክፍያ ያረጋግጡ',
    deposit_account: 'ገቢ የሚደረግበት መለያ',
    amount_deposit: 'የሚገቡት መጠን',
    paste_deposit_msg: 'የገቢ ማረጋገጫ መልእክት ይለጥፉ',
    verify_submit: 'አረጋግጥ እና አስገባ',
    how_to_deposit: 'እንዴት ገቢ ማድረግ እንደሚቻል',
    verifying: 'በማረጋገጥ ላይ...',
    withdraw_funds: 'ገንዘብ ወጪ',
    available_balance: 'ወጪ የሚደረግ ሂሳብ',
    withdraw_amount: 'የወጪ መጠን',
    your_account_num: 'የእርስዎ ሂሳብ ቁጥር',
    request_withdraw: 'ወጪ ጠይቅ',
    how_to_withdraw: 'እንዴት ወጪ ማድረግ እንደሚቻል',
    confirm_withdraw: 'ወጪ ማረጋገጫ',
    your_account: 'የእርስዎ ሂሳብ',
    paste_withdraw_msg: 'የወጪ ማረጋገጫ መልእክት ይለጥፉ',
    verify_withdraw: 'ወጪ አረጋግጥ',
    how_to_play: 'እንዴት እንደሚጫወቱ',
    rule_1: 'የውርርድ ቤት ይምረጡ።',
    rule_2: 'እስከ 2 ካርቶዎችን ይምረጡ።',
    rule_3: 'ጨዋታ ጀምር የሚለውን ይጫኑ።',
    rule_4: 'ቁጥሮች ሲጠሩ ምልክት ያድርጉ።',
    rule_5: 'ቢንጎ የሚለውን የሚጫኑት ሙሉ መስመር ሲያገኙ ብቻ ነው።',
    dep_with_title: 'ገቢ እና ወጪ',
    dep_with_desc: 'በመነሻ ገጹ ላይ ያለውን ገቢ አድርግ ቁልፍ ይጠቀሙ።',
    audio: 'ድምፅ',
    auto_mark_me: 'ራስ-ሰር ምልክት (እኔ)',
    auto_algo: 'ራስ-ሰር አልጎሪዝም',
    players_label: 'ተጫዋቾች',
    waiting: 'በመጠባበቅ ላይ',
    prize: 'ሽልማት',
    active: 'ተጫዋቾች',
    go_lobby: 'ወደ ሎቢ',
    join_wait: 'ተቀላቀል & ጠብቅ',
    insufficient_balance_msg: 'ይህን ውርርድ ለመቀላቀል በቂ ሂሳብ የለዎትም።',
    link_copied: 'የግብዣ ሊንክ ተቀድቷል!',
    first_deposit_bonus: '🎉 የመጀመሪያ ገቢ ቦነስ: 2X!',
    referral_bonus: 'የግብዣ ቦነስ',
    wallet_desc: 'ገቢ + ያሸነፉት',
    bonus_desc: 'ስጦታ + ግብዣ'
  },
  ti: {
    hello: 'ሰላም',
    back: 'ተመለስ',
    close: 'ዕጸው',
    loading: 'ይሰርሕ ኣሎ...',
    ok: 'ሕራይ',
    signin: 'እተው',
    signup: 'ተመዝገብ',
    username: 'ናይ ተጠቃሚ ስም',
    password: 'ፓስዎርድ',
    enter_username: 'ስምካ ኣእቱ',
    enter_password: 'ፓስዎርድ ኣእቱ',
    create_account: 'አካውንት ፍጠር',
    welcome_login_msg: 'እንቋዕ ብደሓን መጻእኩም! በይዘኦም ይእተዉ',
    deposit: '+ ተቀመጥ',
    withdraw: 'ውሰድ',
    logout: 'ውጻእ',
    balance: 'ዋሌት',
    bonus: 'ቦነስ',
    total_playable: 'ጠቅላላ ዝውረድ',
    instructions: 'መምርሒ',
    invite: 'ዓርኪ ዓድም',
    game_title_bingo: 'ቢንጎ',
    game_title_aviator: 'ኣቭያተር',
    game_title_keno: 'ኬኖ',
    play_now: 'ሕጂ ተጫወት',
    select_bingo_house: 'ናይ ቢንጎ ውርርድ ገዛ ምረጽ',
    bet_houses: 'ናይ ውርርድ ቤቶች',
    stake: 'ውርርድ',
    select_boards: 'ካርቶን ምረጽ',
    selected: 'ተመሪጹ',
    start_game: 'ጸወታ ጀምር',
    ready: 'ድሉው!',
    switch_house: 'ቤት ቀይር',
    game_in_progress: 'ጸወታ ይካየድ ኣሎ',
    current_call: 'ህሉው ጻውዒት',
    last_5: 'ናይ መወዳእታ 5',
    live_caller: 'ቀጥታ ጻውዒት',
    auto_bingo: 'ኦቶ ቢንጎ',
    bingo_btn: 'ቢንጎ!',
    your_boards: 'ናካ ካርቶታት',
    tap_mark_hint: 'ቁጽሪ ንምምልካት ጠውቕ። FREE ባዕሉ ይምላእ።',
    next_call_in: 'ቀጻሊ ጻውዒት ኣብ',
    winner: 'ተዓዋቲ',
    winning_board: 'ዝተዓወተ ካርቶ',
    select_payment: 'ናይ ክፍሊት መገዲ ምረጽ',
    recommended: 'ዝተመከረ',
    confirm_payment: 'ክፍሊት ኣረጋግጽ',
    deposit_account: 'ገንዘብ ዝኣትወሉ ሒሳብ',
    amount_deposit: 'ዝኣቱ መጠን',
    paste_deposit_msg: 'ናይ ክፍሊት መልእኽቲ ለጥፍ',
    verify_submit: 'ኣረጋግጽን ስደድን',
    how_to_deposit: 'ከመይ ጌርካ ገንዘብ ተእቱ',
    verifying: 'የረጋግጽ ኣሎ...',
    withdraw_funds: 'ገንዘብ ምውጻእ',
    available_balance: 'ዝወጽእ ባላንስ',
    withdraw_amount: 'ዝወጽእ መጠን',
    your_account_num: 'ናይ ሒሳብ ቁጽሪ',
    request_withdraw: 'ምውጻእ ሕተት',
    how_to_withdraw: 'ከመይ ጌርካ ገንዘብ ተውጽእ',
    confirm_withdraw: 'ምውጻእ ኣረጋግጽ',
    your_account: 'ናካ ሒሳብ',
    paste_withdraw_msg: 'ናይ ምውጻእ መልእኽቲ ለጥፍ',
    verify_withdraw: 'ምውጻእ ኣረጋግጽ',
    how_to_play: 'ከመይ ትጻወት',
    rule_1: 'ናይ ውርርድ ገዛ ምረጽ።',
    rule_2: 'ክሳብ 2 ካርቶን ምረጽ።',
    rule_3: 'ጸወታ ጀምር ጠውቕ።',
    rule_4: 'ቁጽሪ ክጽዋዕ ከሎ ምልክት ግበር።',
    rule_5: 'ቢንጎ እትብሎ ሙሉእ መስመር ምስ ዝመልእ ጥራይ እዩ።',
    dep_with_title: 'ምእታውን ምውጻእን',
    dep_with_desc: 'ኣብ መእተዊ ገጽ ዘሎ ተቀመጥ ዝብል ተጠቐም።',
    audio: 'ድምጺ',
    auto_mark_me: 'ኦቶ ምልክት (ኣነ)',
    auto_algo: 'ኦቶ ኣልጎሪዝም',
    players_label: 'ተጫወቲ',
    waiting: 'ዝጽበዩ',
    prize: 'ሽልማት',
    active: 'ተጫወቲ',
    go_lobby: 'ናብ ሎቢ',
    join_wait: 'ተሓወስ & ተጸበ',
    insufficient_balance_msg: 'ነዚ ውርርድ ምሕዋስ ዘይምኸኣል',
    link_copied: 'ናይ ዕድመ ሊንክ ተቐዲሑ!',
    first_deposit_bonus: '🎉 ቀዳማይ ገንዘብ ቦነስ: 2X!',
    referral_bonus: 'ናይ ዕድመ ቦነስ',
    wallet_desc: 'ዝኣተወ + ዝተዓወተ',
    bonus_desc: 'ቦነስ + ዕድመ'
  },
  or: {
    hello: 'Akkam',
    back: 'Deebi',
    close: 'Cufi',
    loading: 'Hojjechaa jira...',
    ok: 'Tole',
    signin: 'Seeni',
    signup: 'Galmaa',
    username: 'Maqaa Fayyadamaa',
    password: 'Jecha Darbi',
    enter_username: 'Maqaa fayyadamaa galchi',
    enter_password: 'Jecha darbi galchi',
    create_account: 'Akkaawuntii Uumi',
    welcome_login_msg: 'Baga nagaan dhuftan! Seenaa ykn galmaa aa',
    deposit: '+ Galchii',
    withdraw: 'Baasii',
    logout: 'Baa',
    balance: 'Wallet',
    bonus: 'Boonasii',
    total_playable: 'Taphaaf Kan Oolu',
    instructions: 'Qajeelfama',
    invite: 'Michuu Afferi',
    game_title_bingo: 'BINGO',
    game_title_aviator: 'Aviator',
    game_title_keno: 'KENO',
    play_now: 'Amma Taphadhu',
    select_bingo_house: 'Mana Qabsiisaa BINGO Filadhu',
    bet_houses: 'Manni Qabsiisaa',
    stake: 'Qabsiisa',
    select_boards: 'Kaartii Filadhu',
    selected: 'Filatame',
    start_game: 'Tapha Jalqabi',
    ready: 'Qophaa aa!',
    switch_house: 'Mana Qabsiisaa Jijjiiri',
    game_in_progress: 'Tapha itti fufaa jira',
    current_call: 'LAKKOOFSA AMMAA',
    last_5: '5 DARBAN',
    live_caller: 'WAAMAA KALLATTII',
    auto_bingo: 'Bingo Ofiin',
    bingo_btn: 'BINGO!',
    your_boards: 'Kaartii Kee',
    tap_mark_hint: 'Lakkoofsa tuquun mallatteessi. FREE ofiin.',
    next_call_in: 'Itti aanu',
    winner: 'Mo ataa',
    winning_board: 'Kaartii Mo ate',
    select_payment: 'Kaffaltii Filadhu',
    recommended: 'Kan Filatame',
    confirm_payment: 'Kaffaltii Mirkaneessi',
    deposit_account: 'Herrega Galchii',
    amount_deposit: 'Hanga Galchii',
    paste_deposit_msg: 'Ergaa mirkaneessaa galchii',
    verify_submit: 'Mirkaneessi & Galchi',
    how_to_deposit: 'Akkaataa galchii',
    verifying: 'Mirkaneessaa...',
    withdraw_funds: 'Maallaqa Baasuu',
    available_balance: 'Haftee Baasii',
    withdraw_amount: 'Hanga Baasii',
    your_account_num: 'Lakkoofsa Herregaa',
    request_withdraw: 'Baasii Gaafadhu',
    how_to_withdraw: 'Akkaataa baasii',
    confirm_withdraw: 'Baasii Mirkaneessi',
    your_account: 'Herrega Kee',
    paste_withdraw_msg: 'Ergaa mirkaneessaa baasii',
    verify_withdraw: 'Baasii Mirkaneessi',
    how_to_play: 'Akkaataa Taphaa',
    rule_1: 'Mana qabsiisaa filadhu.',
    rule_2: 'Kaartii hanga 2 filadhu.',
    rule_3: 'Tapha Jalqabi kan jedhu tuqi.',
    rule_4: 'Lakkoofsa waamame mallatteessi.',
    rule_5: 'BINGO kan jedhu yeroo sararri guutu qofa tuqi.',
    dep_with_title: 'Galchii fi Baasii',
    dep_with_desc: 'Fuula duraa irratti button galchii fayyadami.',
    audio: 'Sagalee',
    auto_mark_me: 'Ofiin Mallatteessi (Ana)',
    auto_algo: 'Algoorizimii Ofiin',
    players_label: 'Taphataa',
    waiting: 'Eegaa jira',
    prize: 'Badhaasa',
    active: 'Taphataa',
    go_lobby: 'Gara Lobby',
    join_wait: 'Seeni & Eegi',
    insufficient_balance_msg: 'Baalansiin kee xiqqaadha.',
    link_copied: 'Linkiin afeerraa waraabame!',
    first_deposit_bonus: '🎉 Galchii Jalqabaa Boonasii: 2X!',
    referral_bonus: 'Boonasii Afeerraa',
    wallet_desc: 'Galchii + Bu aa',
    bonus_desc: 'Boonasii + Affeerraa'
  }
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [playerId, setPlayerId] = useState<string>('')
  const [userId, setUserId] = useState<string>('')
  const [username, setUsername] = useState<string>('')
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false)
  
  // Auth state
  const [loginMode, setLoginMode] = useState<'login' | 'signup'>('login')
  const [loginUsername, setLoginUsername] = useState<string>('')
  const [loginPassword, setLoginPassword] = useState<string>('')
  const [loginError, setLoginError] = useState<string>('')
  const [loginLoading, setLoginLoading] = useState<boolean>(false)

  // App Settings
  const [language, setLanguage] = useState<Language>('en')
  const [showLanguageModal, setShowLanguageModal] = useState<boolean>(false)

  // Game Data
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
  
  // Balance State: Wallet (Deposits/Wins) vs Bonus (Promo/Referrals)
  const [balance, setBalance] = useState<number>(0)
  const [bonus, setBonus] = useState<number>(0)
  
  // Game Play State
  const [called, setCalled] = useState<number[]>([])
  const [picks, setPicks] = useState<number[]>([])
  const [activeGameBoardId, setActiveGameBoardId] = useState<number | null>(null)
  const [boardHtmlProvided, setBoardHtmlProvided] = useState<boolean>(false)
  const [currentPage, setCurrentPage] = useState<Page>('login')
  const [isReady, setIsReady] = useState<boolean>(false)
  const [markedNumbers, setMarkedNumbers] = useState<Set<number>>(new Set())
  const [callCountdown, setCallCountdown] = useState<number>(0)
  const [lastCalled, setLastCalled] = useState<number | null>(null)
  
  // Options / Automation
  const [autoMark, setAutoMark] = useState<boolean>(false)
  const [autoAlgoMark, setAutoAlgoMark] = useState<boolean>(false)
  const [autoBingo, setAutoBingo] = useState<boolean>(false)
  const [winnerInfo, setWinnerInfo] = useState<{
    boardId: number
    lineIndices: number[]
    playerId?: string
    prize?: number
    stake?: number
  } | null>(null)
  
  const [audioPack, setAudioPack] = useState<string>('amharic') 
  const [audioOn, setAudioOn] = useState<boolean>(true)
  const callTimerRef = useRef<number | null>(null)
  
  // Deposit / Withdraw State
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

  // Welcome bonus banner
  const [showBonusClaimed, setShowBonusClaimed] = useState<boolean>(false)
  
  // NEW: First deposit tracking & referral
  const [isFirstDeposit, setIsFirstDeposit] = useState<boolean>(true)
  const [referralCode, setReferralCode] = useState<string>('')
  const [showLinkCopied, setShowLinkCopied] = useState<boolean>(false)

  // Refs to avoid stale state inside socket listeners
  const playerIdRef = useRef<string>(playerId)
  const calledRef = useRef<number[]>(called)
  const lastCalledRef = useRef<number | null>(lastCalled)
  const currentBetHouseRef = useRef<number | null>(currentBetHouse)

  useEffect(() => { playerIdRef.current = playerId }, [playerId])
  useEffect(() => { calledRef.current = called }, [called])
  useEffect(() => { lastCalledRef.current = lastCalled }, [lastCalled])
  useEffect(() => { currentBetHouseRef.current = currentBetHouse }, [currentBetHouse])

  // --- Helper: Get Translation ---
  const t = (key: keyof typeof translations['en']) => {
    return translations[language][key] || translations['en'][key]
  }

  // --- Initialize Language from LocalStorage ---
  useEffect(() => {
    const savedLang = localStorage.getItem('appLanguage') as Language
    if (savedLang && ['en', 'am', 'ti', 'or'].includes(savedLang)) {
      setLanguage(savedLang)
    }
  }, [])

  // --- Handle New User Flow ---
  useEffect(() => {
    if (currentPage === 'welcome' && localStorage.getItem('isNewUser') === 'true') {
      setShowLanguageModal(true)
    }
  }, [currentPage])

  const handleLanguageSelect = (lang: Language) => {
    setLanguage(lang)
    localStorage.setItem('appLanguage', lang)
    setShowLanguageModal(false)

    if (localStorage.getItem('isNewUser') === 'true') {
      localStorage.removeItem('isNewUser')
      setShowBonusClaimed(true)
    }
  }

  // --- Capture referral code from URL ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    if (ref) {
      setReferralCode(ref);
      localStorage.setItem('referralCode', ref);
    } else {
      const storedRef = localStorage.getItem('referralCode');
      if (storedRef) {
        setReferralCode(storedRef);
      }
    }
  }, []);

  // Telegram Auto-Login
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tgToken = urlParams.get('tg_token');
    
    if (tgToken) {
      setLoginLoading(true);
      setCurrentPage('login');
      
      fetch(`${getApiUrl()}/api/telegram/auto-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tgToken })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('username', data.username);
            localStorage.setItem('authToken', data.token);
            
            setUserId(data.userId);
            setUsername(data.username);
            setIsAuthenticated(true);
            
            // FIX for "100 Birr Wallet" issue:
            // If the backend returns the old default of 100 Balance for a new user (isFirstDeposit=true),
            // and 0 bonus, we force swap it to 0 Balance and 30 Bonus to meet your requirements.
            let userBalance = data.balance || 0;
            let userBonus = data.bonus || 0;
            const isFirst = data.isFirstDeposit !== false;
            
            if (isFirst && userBalance === 100 && userBonus === 0) {
              userBalance = 0;
              userBonus = 30; // Force 30 Bonus for new Telegram users
            }
            
            setBalance(userBalance);
            setBonus(userBonus);
            setIsFirstDeposit(isFirst);
            setLoginLoading(false);
            
            window.history.replaceState({}, document.title, window.location.pathname);
            
            setTimeout(() => {
              setCurrentPage('welcome');
            }, 100);
          } else {
            setLoginError(data.error || 'Auto-login failed');
            setLoginLoading(false);
            setCurrentPage('login');
          }
        })
        .catch(err => {
          setLoginError('Connection error during auto-login');
          setLoginLoading(false);
          setCurrentPage('login');
        });
      
      return;
    }
    
    checkExistingSession();
  }, []);

  const checkExistingSession = () => {
    try {
      const savedUserId = localStorage.getItem('userId');
      const savedUsername = localStorage.getItem('username');
      const savedToken = localStorage.getItem('authToken');
      
      if (savedUserId && savedUsername && savedToken) {
        fetch(`${getApiUrl()}/api/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: savedUserId, token: savedToken }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              setUserId(savedUserId);
              setUsername(savedUsername);
              setIsAuthenticated(true);
              setIsFirstDeposit(data.isFirstDeposit !== false);
              setBalance(data.balance || 0);
              setBonus(data.bonus || 0);
              setCurrentPage('welcome');
            } else {
              localStorage.removeItem('userId');
              localStorage.removeItem('username');
              localStorage.removeItem('authToken');
              setCurrentPage('login');
            }
          })
          .catch(() => {
            localStorage.removeItem('userId');
            localStorage.removeItem('username');
            localStorage.removeItem('authToken');
            setCurrentPage('login');
          });
      } else {
        setCurrentPage('login');
      }
    } catch (error) {
      setCurrentPage('login');
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return
    
    const s = io(getApiUrl(), { 
      transports: ['websocket', 'polling'],
      reconnection: true,
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
      
      // Update both balances
      setBalance(d.balance || 0)
      setBonus(d.bonus || 0)
    
      playerIdRef.current = d.playerId
      calledRef.current = d.called
      currentBetHouseRef.current = d.stake
    
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
      if (d.phase === 'calling' && currentPage === 'lobby' && !isWaiting) {
        setCurrentPage('game')
      }
      if (d.phase === 'lobby') {
        setPicks([])
        setMarkedNumbers(new Set())
        setIsReady(false)
        setIsWaiting(false)
        setTakenBoards([])
        autoBingoSentRef.current = false
      }
    })
    
    s.on('players', (d: any) => {
      setPlayers(d.count || 0)
      setWaitingPlayers(d.waitingCount || 0)
    })
    
    s.on('bet_houses_status', (d: any) => {
      if (d.betHouses) setBetHouses(d.betHouses)
    })

    s.on('boards_taken', (d: any) => {
      if (d.takenBoards) setTakenBoards(d.takenBoards as number[])
    })

    s.on('call', (d: any) => {
      calledRef.current = d.called
      lastCalledRef.current = d.number
      setCalled(d.called)
      setLastCalled(d.number)
      setCallCountdown(5)
    
      if (autoMark || autoAlgoMark) {
        setMarkedNumbers(prev => {
          const next = new Set(prev)
          next.add(d.number)
          return next
        })
      }
    
      if (autoBingoRef.current && !autoBingoSentRef.current) {
        const marks = new Set<number>(d.called)
        const win = findBingoWinIncludingLast(marks, d.number, picksRef.current)
        const stakeToUse = currentBetHouseRef.current
        if (win && stakeToUse) {
          autoBingoSentRef.current = true
          s.emit('bingo', {
            stake: stakeToUse,
            boardId: win.boardId,
            lineIndices: win.line,
          })
        }
      }
    
      if (audioOnRef.current && !isWaitingRef.current && phaseRef.current === 'calling') {
        playCallSound(d.number)
      }
    })
    
    s.on('winner', (d: any) => {
      let boardId: number | undefined = typeof d.boardId === 'number' ? d.boardId : undefined
      let lineIndices: number[] | undefined = Array.isArray(d.lineIndices) ? d.lineIndices : undefined
    
      if ((!boardId || !lineIndices) && d.playerId === playerIdRef.current) {
        const marks = new Set<number>(calledRef.current)
        const win =
          findBingoWinIncludingLast(marks, lastCalledRef.current, picksRef.current) ||
          findAnyBingoWin(marks, picksRef.current)
    
        if (win) {
          boardId = win.boardId
          lineIndices = win.line
        }
      }
    
      if (boardId && lineIndices && lineIndices.length > 0) {
        setWinnerInfo({
          boardId,
          lineIndices,
          playerId: d.playerId,
          prize: d.prize,
          stake: d.stake,
        })
      } else {
        setWinnerInfo(null)
      }
    
      setPicks([])
      setMarkedNumbers(new Set())
      setCurrentPage('bingoHouseSelect') 
      setIsReady(false)
      setIsWaiting(false)
      autoBingoSentRef.current = false
    })
    
    s.on('game_start', () => {
      if (!isWaiting) setCurrentPage('game')
      autoBingoSentRef.current = false
    })
    
    s.on('start_game_confirm', (d: any) => {
      if (d.isWaiting) {
        setIsWaiting(true)
      } else {
        setCurrentPage('game')
        setIsWaiting(false)
      }
    })
    
    s.on('balance_update', (d: any) => {
      // Update both balance (Wallet) and bonus (Referrals/Promos)
      if (d.balance !== undefined) setBalance(d.balance)
      if (d.bonus !== undefined) setBonus(d.bonus)
      if (d.isFirstDeposit !== undefined) {
        setIsFirstDeposit(d.isFirstDeposit)
      }
    })
    
    s.emit('get_bet_houses_status')
    
    return () => { s.disconnect() }
  }, [isAuthenticated, userId, username])
  
  useEffect(() => {
    if (currentPage !== 'game') return
    setActiveGameBoardId(prev => {
      if (prev && picks.includes(prev)) return prev
      return picks[0] ?? null
    })
  }, [currentPage, picks])

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

  const board = useMemo(() => Array.from({ length: 100 }, (_, i) => i + 1), []);

  const togglePick = (n: number) => {
    if (phase !== 'lobby' && phase !== 'countdown' && !isWaiting) return
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

    // Allow usage of both Wallet and Bonus for betting
    const totalFunds = balance + bonus
    if (totalFunds < stakeAmount) {
      alert(t('insufficient_balance_msg'));
      return; 
    }

    setCurrentBetHouse(stakeAmount)
    setStake(stakeAmount)
    setPicks([])
    setIsReady(false)
    setIsWaiting(false)
    socket.emit('join_bet_house', stakeAmount)
    setCurrentPage('lobby') 
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
    if (!isWaiting) {
      setCurrentPage('game')
    }
  }

  const toggleMark = (number: number) => {
    if (phase !== 'calling') return
    if (autoAlgoMark) return 
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
    for (let row = 0; row < 5; row++) {
      let count = 0
      for (let col = 0; col < 5; col++) {
        const idx = row * 5 + col
        const num = board[idx]
        if (num === -1 || markedNumbers.has(num)) count++
      }
      if (count === 5) return true
    }
    for (let col = 0; col < 5; col++) {
      let count = 0
      for (let row = 0; row < 5; row++) {
        const idx = row * 5 + col
        const num = board[idx]
        if (num === -1 || markedNumbers.has(num)) count++
      }
      if (count === 5) return true
    }
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
      const lines: number[][] = []
      for (let r = 0; r < 5; r++) lines.push([0,1,2,3,4].map(c => grid[r*5 + c]))
      for (let c = 0; c < 5; c++) lines.push([0,1,2,3,4].map(r => grid[r*5 + c]))
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

  const findAnyBingoWin = (
    marks: Set<number>,
    boardIdsOverride?: number[]
  ): { boardId: number; line: number[] } | null => {
    const boardsToCheck = boardIdsOverride ?? picks
    for (const boardId of boardsToCheck) {
      const grid = getBoard(boardId)
      if (!grid) continue
      const lines: number[][] = []
      for (let r = 0; r < 5; r++) lines.push([0,1,2,3,4].map(c => r * 5 + c))
      for (let c = 0; c < 5; c++) lines.push([0,1,2,3,4].map(r => r * 5 + c))
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

  const findBingoWinIncludingLast = (
    marks: Set<number>,
    last: number | null,
    boardIdsOverride?: number[]
  ): { boardId: number; line: number[] } | null => {
    if (!last) return null
    const boardsToCheck = boardIdsOverride ?? picks

    for (const boardId of boardsToCheck) {
      const grid = getBoard(boardId)
      if (!grid) continue

      const lines: number[][] = []
      for (let r = 0; r < 5; r++) lines.push([0,1,2,3,4].map(c => r * 5 + c))
      for (let c = 0; c < 5; c++) lines.push([0,1,2,3,4].map(r => r * 5 + c))
      lines.push([0,1,2,3,4].map(i => i * 5 + i))
      lines.push([0,1,2,3,4].map(i => i * 5 + (4 - i)))

      for (const idxLine of lines) {
        const nums = idxLine.map(idx => grid[idx])
        if (!nums.includes(last)) continue

        const complete = idxLine.every(idx => {
          const num = grid[idx]
          return num === -1 || marks.has(num)
        })

        if (complete) return { boardId, line: idxLine }
      }
    }

    return null
  }

  const hasBingoIncludingLastCalled = (
    overrideCalled?: number[],
    overrideLastCalled?: number | null
  ): boolean => {
    const effectiveLastCalled = overrideLastCalled ?? lastCalled
    if (!effectiveLastCalled) return false
    const effectiveCalled = overrideCalled ?? called
    const marks = new Set<number>(
      autoAlgoMark ? effectiveCalled : Array.from(markedNumbers)
    )
    return hasBingoWithMarksAndLast(marks, effectiveLastCalled)
  }

  const onPressBingo = (overrideCalled?: number[], overrideLastCalled?: number | null) => {
    if (phase !== 'calling' || isWaiting) return
    if (!hasBingoIncludingLastCalled(overrideCalled, overrideLastCalled)) {
      alert('No valid BINGO found that includes the last called number. Keep marking!')
      return
    }
    if (!currentBetHouse) return
    const effectiveLastCalled = overrideLastCalled ?? lastCalled
    const effectiveCalled = overrideCalled ?? called
    const marks = new Set<number>(
      autoAlgoMark ? effectiveCalled : Array.from(markedNumbers)
    )
    const win = findBingoWinIncludingLast(marks, effectiveLastCalled, picks)
    socket?.emit('bingo', {
      stake: currentBetHouse,
      boardId: win?.boardId,
      lineIndices: win?.line,
    })
    autoBingoSentRef.current = true
  }

  // --- Generate Telegram Bot Deep Link ---
  const getInviteLink = () => {
    // This redirects the invited user to the Telegram Bot with the inviter's userId as the start parameter
    // The Bot handles registration and awards the 20 Birr bonus to the inviter
    return `https://t.me/WinBingoGamesBot?start=${userId}`
  }

  const handleCopyInviteLink = () => {
    const link = getInviteLink()
    navigator.clipboard.writeText(link).then(() => {
      setShowLinkCopied(true)
      setTimeout(() => setShowLinkCopied(false), 2000)
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = link
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setShowLinkCopied(true)
      setTimeout(() => setShowLinkCopied(false), 2000)
    })
  }

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

  const numberToLetter = (n: number) => (n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O')

  const numberToWord = (n: number): string => {
    const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
    const tens = ['', 'TEN', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY']
    if (n === 0) return 'ZERO'
    if (n < 20) return ones[n]
    const t = Math.floor(n / 10)
    const o = n % 10
    if (o === 0) return tens[t]
    return `${tens[t]}-${ones[o]}`
  }

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

  const parseAmount = (message: string): number | null => {
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
    const numbers = message.match(/\b(\d{2,}(?:\.\d{2})?)\b/g)
    if (numbers && numbers.length > 0) {
      const amounts = numbers.map(n => parseFloat(n)).filter(n => !isNaN(n) && n >= 10)
      if (amounts.length > 0) return Math.max(...amounts)
    }
    return null
  }

  const parseTransactionId = (text: string): string | null => {
    const patterns = [
      /(?:txn|trans|ref|reference|transaction\s*id|id)[:\s-]*([A-Z0-9]{6,})/i,
      /(?:txn|trans|ref|reference|transaction\s*id|id)[:\s-]*([a-z0-9]{6,})/i,
    ]
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) return match[1].trim().toUpperCase()
    }
    const tokens = text.match(/[A-Z0-9]{8,20}/gi)
    if (tokens) {
      const sorted = tokens.sort((a,b)=>b.length-a.length)
      return sorted[0].toUpperCase()
    }
    return null
  }

  const playCallSound = async (n: number) => {
    const letter = numberToLetter(n)
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
              <span>{t('stake')}: <b>{stake} Birr</b></span>
              <span>{t('active')}: <b>{players}</b></span>
              {waitingPlayers > 0 && <span>{t('waiting')}: <b>{waitingPlayers}</b></span>}
              <span>{t('prize')}: <b>{prize} Birr</b></span>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3 sm:mb-6">
            <div className="text-lg sm:text-2xl font-bold flex items-center flex-wrap gap-2">
              {t('select_boards')}
              {isWaiting && (
                <span className="px-2 sm:px-3 py-0.5 sm:py-1 rounded bg-yellow-500 text-black text-xs sm:text-sm font-bold">
                  {t('waiting')}...
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
                {t('game_in_progress')}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-3 sm:mb-6">
            <label className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <span className="text-slate-300">{t('audio')}:</span>
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
              <span className="text-slate-300">{t('auto_mark_me')}</span>
            </label>
            <label className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
              <input
                type="checkbox"
                checked={autoAlgoMark}
                onChange={(e) => setAutoAlgoMark(e.target.checked)}
                className="w-3 h-3 sm:w-4 sm:h-4"
              />
              <span className="text-slate-300">{t('auto_algo')}</span>
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
          
          {picks.length > 0 && (
            <div className="mb-3 sm:mb-6">
              <div className="text-slate-300 mb-2 sm:mb-4 text-xs sm:text-sm">{t('selected')} ({picks.length}/2):</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4">
                {picks.map((boardId) => (
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
              {t('selected')}: {picks.length}/2 boards
              {isWaiting && picks.length > 0 && (
                <div className="mt-1 sm:mt-2 text-yellow-400 text-xs sm:text-sm">
                  {t('game_in_progress')}
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
                onClick={() => setCurrentPage('bingoHouseSelect')}
              >
                {t('switch_house')}
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
                {isReady ? (isWaiting ? t('waiting') : t('ready')) : t('start_game')}
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
            <div className="text-slate-400 text-xs sm:text-sm">{t('welcome_login_msg')}</div>
            {referralCode && (
              <div className="mt-2 px-3 py-1 bg-emerald-500/20 border border-emerald-500/50 rounded-lg text-emerald-400 text-xs">
                🎁 Invited by a friend! Sign up for bonus rewards!
              </div>
            )}
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
              {t('signin')}
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
              {t('signup')}
            </button>
          </div>

          {loginError && (
            <div className="bg-red-500/20 border border-red-500 rounded-lg p-3 text-red-300 text-sm">
              {loginError}
            </div>
          )}

          <div className="space-y-3 sm:space-y-4">
            <div>
              <label className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2 block">{t('username')}</label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder={t('enter_username')}
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
              <label className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2 block">{t('password')}</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder={t('enter_password')}
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
              {loginLoading ? t('loading') : loginMode === 'login' ? t('signin') : t('create_account')}
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
      setIsFirstDeposit(result.isFirstDeposit !== false)
      setBalance(result.balance || 0)
      setBonus(result.bonus || 0)
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
      // Get referral code from state or localStorage
      const refCode = referralCode || localStorage.getItem('referralCode') || ''
      
      const response = await fetch(`${getApiUrl()}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
          initialBonus: 30, // Changed from initialBalance to initialBonus
          referralCode: refCode, // Send referral code for 20 Birr reward to inviter
        }),
      })
      
      const result = await response.json()
      
      if (!result.success) {
        setLoginError(result.error || 'Signup failed')
        setLoginLoading(false)
        return
      }
      
      localStorage.setItem('userId', result.userId)
      localStorage.setItem('username', result.username)
      localStorage.setItem('authToken', result.token)
      localStorage.setItem('isNewUser', 'true')
      // Clear referral code after successful signup
      localStorage.removeItem('referralCode')
      
      setUserId(result.userId)
      setUsername(result.username)
      setIsAuthenticated(true)
      setBalance(0) // Start with 0 wallet balance
      setBonus(30) // Start with 30 bonus
      setIsFirstDeposit(true)
      setLoginUsername('')
      setLoginPassword('')
      setReferralCode('')
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

  const renderWelcomePage = () => (
    <div className="h-screen bg-slate-900 text-white overflow-y-auto">
      <div className="w-full max-w-5xl mx-auto p-2 sm:p-4 space-y-2 sm:space-y-4">
        <div className="flex items-center justify-between py-1 sm:py-2">
          <div className="text-lg sm:text-2xl font-bold truncate pr-2">{t('hello')}, {username}!</div>
          <div className="flex gap-1 sm:gap-2 flex-shrink-0">
            <button
              className="px-2 sm:px-4 py-1 sm:py-2 rounded bg-amber-500 text-black font-semibold text-xs sm:text-sm"
              onClick={() => setCurrentPage('depositSelect')}
            >
              {t('deposit')}
            </button>
            <button
              className="px-2 sm:px-4 py-1 sm:py-2 rounded bg-blue-500 text-white font-semibold text-xs sm:text-sm"
              onClick={() => setCurrentPage('withdrawal')}
            >
              {t('withdraw')}
            </button>
            <button
              className="px-2 sm:px-4 py-1 sm:py-2 rounded bg-slate-700 text-white font-semibold text-xs sm:text-sm"
              onClick={handleLogout}
            >
              {t('logout')}
            </button>
          </div>
        </div>

        {/* --- Language Selection Modal --- */}
        {showLanguageModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-slate-800 p-6 rounded-2xl shadow-2xl max-w-sm w-full border border-white/10">
              <h2 className="text-2xl font-bold text-center mb-6 text-white">{t('select_lang')}</h2>
              <div className="grid grid-cols-1 gap-3">
                <button onClick={() => handleLanguageSelect('en')} className="p-4 bg-slate-700 hover:bg-emerald-600 rounded-xl font-bold text-lg transition-all border border-white/5">English</button>
                <button onClick={() => handleLanguageSelect('am')} className="p-4 bg-slate-700 hover:bg-emerald-600 rounded-xl font-bold text-lg transition-all border border-white/5">አማርኛ</button>
                <button onClick={() => handleLanguageSelect('ti')} className="p-4 bg-slate-700 hover:bg-emerald-600 rounded-xl font-bold text-lg transition-all border border-white/5">ትግርኛ</button>
                <button onClick={() => handleLanguageSelect('or')} className="p-4 bg-slate-700 hover:bg-emerald-600 rounded-xl font-bold text-lg transition-all border border-white/5">Oromigna</button>
              </div>
            </div>
          </div>
        )}

        {/* --- Welcome Bonus Notification (30 Birr) --- */}
        {showBonusClaimed && !showLanguageModal && (
          <div className="bg-emerald-500 text-black p-4 rounded-xl flex items-center justify-between animate-bounce shadow-[0_0_15px_rgba(16,185,129,0.5)]">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎁</span>
              <div>
                <div className="font-black text-sm">Welcome Bonus!</div>
                <div className="text-xs font-bold">30 Birr added to your bonus balance!</div>
              </div>
            </div>
            <button 
              onClick={() => setShowBonusClaimed(false)}
              className="bg-black/20 hover:bg-black/40 rounded-full w-8 h-8 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* --- First Deposit 2X Bonus Banner --- */}
        {isFirstDeposit && (
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-black p-3 rounded-xl flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💰</span>
              <div>
                <div className="font-black text-sm">{t('first_deposit_bonus')}</div>
                <div className="text-xs font-bold">Your first deposit will be doubled!</div>
              </div>
            </div>
          </div>
        )}

        {/* --- Link Copied Toast --- */}
        {showLinkCopied && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-emerald-500 text-black px-6 py-3 rounded-xl font-bold shadow-lg animate-bounce">
            ✓ {t('link_copied')}
          </div>
        )}

        {/* Dual Balance card */}
        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          <div className="bg-rose-500/80 rounded-lg sm:rounded-xl p-3 sm:p-5 flex flex-col justify-between h-full">
            <div>
              <div className="uppercase text-[10px] sm:text-xs tracking-wider opacity-90 font-bold">{t('balance')}</div>
              <div className="text-xs text-white/70 mb-1">{t('wallet_desc')}</div>
              <div className="text-xl sm:text-3xl font-extrabold">{balance}</div>
            </div>
            <div className="text-right text-xs sm:text-sm font-bold opacity-80 mt-2">ETB</div>
          </div>
          
          <div className="bg-purple-600/80 rounded-lg sm:rounded-xl p-3 sm:p-5 flex flex-col justify-between h-full">
            <div>
              <div className="uppercase text-[10px] sm:text-xs tracking-wider opacity-90 font-bold">{t('bonus')}</div>
              <div className="text-xs text-white/70 mb-1">{t('bonus_desc')}</div>
              <div className="text-xl sm:text-3xl font-extrabold">{bonus}</div>
            </div>
            <div className="text-right text-xs sm:text-sm font-bold opacity-80 mt-2">ETB</div>
          </div>
        </div>
        
        <div className="bg-slate-800 rounded-lg p-2 text-center text-xs sm:text-sm text-emerald-400 font-bold border border-emerald-500/20">
          {t('total_playable')}: {balance + bonus} Birr
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            className="px-2 sm:px-4 py-1.5 sm:py-3 rounded bg-slate-800 hover:bg-slate-700 text-xs sm:text-sm flex-1"
            onClick={() => setCurrentPage('instructions')}
          >
            {t('instructions')}
          </button>
          <button
            className="px-2 sm:px-4 py-1.5 sm:py-3 rounded bg-purple-600 hover:bg-purple-500 text-xs sm:text-sm flex-1 font-semibold"
            onClick={handleCopyInviteLink}
          >
            🔗 {t('invite')}
          </button>
        </div>

        {/* Invite Link Display */}
        <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
          <div className="text-xs text-slate-400 mb-1">Your unique invite link:</div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={getInviteLink()}
              className="flex-1 bg-slate-900 text-slate-300 text-xs p-2 rounded border border-slate-600 outline-none"
            />
            <button
              onClick={handleCopyInviteLink}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-xs font-bold"
            >
              Copy
            </button>
          </div>
          <div className="text-xs text-amber-400 mt-2">
            🎁 Earn 20 Birr Bonus for each friend who joins via the bot!
          </div>
        </div>

        {/* Game Selection Buttons */}
        <div className="space-y-4">
            {/* BINGO Game Button */}
            <div className="bg-emerald-700/80 rounded-xl p-4 shadow-lg border border-white/10">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-2xl sm:text-3xl font-black">{t('game_title_bingo')}</h3>
                    <div className="flex items-center gap-1">
                        <span className="bg-blue-500 text-white rounded px-2 py-1 text-sm font-bold">B</span>
                        <span className="bg-pink-500 text-white rounded px-2 py-1 text-sm font-bold">I</span>
                        <span className="bg-purple-500 text-white rounded px-2 py-1 text-sm font-bold">N</span>
                        <span className="bg-green-500 text-white rounded px-2 py-1 text-sm font-bold">G</span>
                        <span className="bg-orange-500 text-white rounded px-2 py-1 text-sm font-bold">O</span>
                    </div>
                </div>
                <button
                    onClick={() => setCurrentPage('bingoHouseSelect')}
                    className="w-full bg-slate-900/50 hover:bg-slate-900/70 text-white font-bold text-base sm:text-lg py-3 rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
                >
                    {t('play_now')}
                </button>
            </div>

            {/* Aviator Game Button (Placeholder) */}
            <div className="bg-red-700/80 rounded-xl p-4 shadow-lg border border-white/10">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-2xl sm:text-3xl font-black">{t('game_title_aviator')}</h3>
                    <div className="text-5xl">✈️</div>
                </div>
                <button
                    onClick={() => alert('Aviator game is coming soon!')}
                    className="w-full bg-slate-900/50 hover:bg-slate-900/70 text-white font-bold text-base sm:text-lg py-3 rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
                >
                    {t('play_now')}
                </button>
            </div>

            {/* KENO Game Button */}
            <div className="bg-purple-700/80 rounded-xl p-4 shadow-lg border border-white/10">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-2xl sm:text-3xl font-black">{t('game_title_keno')}</h3>
                    <div className="h-12 w-12 rounded-full bg-blue-500 flex items-center justify-center text-xl font-black flex-shrink-0">80</div>
                </div>
                <a href="/prokeno.html" className="block w-full">
                    <button className="w-full bg-slate-900/50 hover:bg-slate-900/70 text-white font-bold text-base sm:text-lg py-3 rounded-lg shadow-md transition-all flex items-center justify-center gap-2">
                        {t('play_now')}
                    </button>
                </a>
            </div>
        </div>

        <div className="text-[10px] sm:text-xs text-slate-400 pb-2">Version preview</div>
      </div>
    </div>
  )

  const renderDepositSelect = () => (
  <div className="h-screen bg-black text-white p-5">
    {/* Header */}
    <div className="flex items-center mb-6">
      <button
        className="text-white text-xl mr-4"
        onClick={() => setCurrentPage('welcome')}
      >
        ←
      </button>
      <h1 className="text-xl font-bold">{t('select_payment')}</h1>
    </div>

    {/* Banner: First Deposit Bonus */}
    {isFirstDeposit && (
      <div className="bg-gradient-to-r from-orange-500 to-yellow-400 text-black p-6 rounded-2xl mb-6 shadow-xl">
        <div className="text-2xl font-black mb-1">🎉 First Deposit Bonus: 2X!</div>
        <div className="">Your deposit will be doubled!</div>
      </div>
    )}

    {/* Recommended label */}
    <div className="text-green-400 font-bold text-sm mb-2">Recommended</div>

    {/* Telebirr Option */}
    <div
      onClick={() => {
        setSelectedProvider('Telebirr');
        setCurrentPage('depositConfirm');
      }}
      className="bg-[#111] p-4 rounded-xl border border-green-600 flex items-center justify-between mb-4"
    >
      <div className="flex items-center gap-3">
        <img src="/icons/telebirr.png" className="w-10 h-10" />
        <div className="text-lg font-semibold">Telebirr</div>
      </div>
      <div className="text-white text-xl">›</div>
    </div>

    {/* Ebirr Option */}
    <div
      onClick={() => {
        setSelectedProvider('Ebirr');
        setCurrentPage('depositConfirm');
      }}
      className="bg-[#111] p-4 rounded-xl border border-[#1dd75f] flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <img src="/icons/ebirr.png" className="w-10 h-10" />
        <div className="text-lg font-semibold">Ebirr (KAAFI)</div>
      </div>
      <div className="text-white text-xl">›</div>
    </div>
  </div>
     )
  
  const renderDepositConfirm = () => (
  <div className="min-h-screen bg-black text-white p-5">

    {/* Back */}
    <div className="flex items-center mb-6">
      <button
        className="text-white text-xl mr-4"
        onClick={() => setCurrentPage('depositSelect')}
      >
        ←
      </button>
      <h1 className="text-xl font-bold">{t('confirm_payment')}</h1>
    </div>

    {/* Provider */}
    <div className="text-green-400 text-sm mb-4">
      - {selectedProvider}
    </div>

    {/* First deposit bonus banner */}
    {isFirstDeposit && (
      <div className="bg-gradient-to-r from-orange-500 to-yellow-400 text-black p-6 rounded-2xl mb-6 shadow-xl">
        <div className="text-2xl font-black mb-1">🎉 First Deposit Bonus: 2X!</div>
        <div className="font-semibold">
          {depositAmount
            ? `Your deposit will be doubled to ${Number(depositAmount) * 2} Birr!`
            : 'Your deposit will be doubled!'
          }
        </div>
      </div>
    )}

    {/* Deposit Account Box */}
    <div className="bg-[#111] p-4 rounded-xl border border-gray-700 mb-6">
      <div className="text-gray-400 text-sm mb-1">Deposit accounts</div>
      <div className="text-lg font-bold">0999282572</div>
      <div className="text-gray-400 text-sm">Abeje Dita Debele</div>
    </div>

    {/* Amount Input */}
    <div className="mb-5">
      <input
        type="text"
        inputMode="numeric"
        value={depositAmount}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || /^\d+$/.test(v)) setDepositAmount(v);
        }}
        placeholder="Amount"
        className="w-full h-14 bg-[#111] px-4 rounded-xl border border-gray-700 text-white text-base"
      />
    </div>

    {/* Paste SMS Input */}
    <div className="mb-5">
      <textarea
        value={depositMessage}
        onChange={(e) => setDepositMessage(e.target.value)}
        className="w-full bg-[#111] p-4 rounded-xl border border-gray-700 text-white text-sm h-32"
        placeholder="Paste SMS here"
      />
    </div>

    {/* Submit Button */}
    <button
      disabled={!depositMessage.trim() || !depositAmount}
      onClick={async () => {
        setDepositVerifying(true);

        try {
          const baseAmount = Number(depositAmount);
          // Backend handles the doubling logic for first deposit, we just send flag
          const finalAmount = isFirstDeposit ? baseAmount * 2 : baseAmount;

          const response = await fetch(`${getApiUrl()}/api/deposit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              amount: baseAmount,
              // Note: finalAmount is calculated by backend usually, but passing here for context if needed
              provider: selectedProvider,
              message: depositMessage,
              isFirstDeposit,
            }),
          });

          const result = await response.json();

          if (result.success) {
            if (isFirstDeposit) setIsFirstDeposit(false);
            alert('Deposit submitted successfully!');
            setDepositAmount('');
            setDepositMessage('');
            setCurrentPage('welcome');
          } else {
            alert(result.error || 'Deposit failed');
          }
        } catch {
          alert('Network error, please try again');
        }

        setDepositVerifying(false);
      }}
      className="w-full h-14 bg-green-600 rounded-xl font-bold disabled:opacity-40"
    >
      {depositVerifying ? 'Verifying…' : 'Submit Deposit'}
    </button>

    {/* How to Deposit Section */}
    <div className="mt-10">
      <div className="text-lg font-bold mb-3">How to deposit</div>

      {/* Placeholder for video thumbnail */}
      <div className="bg-[#111] h-48 rounded-xl border border-gray-700 flex items-center justify-center">
        <div className="text-gray-500">Video tutorial</div>
      </div>
    </div>

  </div>
)
  // --- Instructions Page ---
  const renderInstructionsPage = () => (
    <div className="h-screen bg-slate-900 text-white p-4 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-6 mt-8">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold">{t('instructions')}</div>
          <button className="px-4 py-2 bg-slate-800 rounded" onClick={() => setCurrentPage('welcome')}>{t('back')}</button>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl space-y-4 text-slate-300">
          <h3 className="text-xl font-bold text-white">{t('how_to_play')}</h3>
          <ul className="list-disc pl-5 space-y-2">
            <li>{t('rule_1')}</li>
            <li>{t('rule_2')}</li>
            <li>{t('rule_3')}</li>
            <li>{t('rule_4')}</li>
            <li>{t('rule_5')}</li>
          </ul>
        </div>
        
        {/* Bonuses Section */}
        <div className="bg-emerald-800/50 p-6 rounded-xl space-y-4 text-slate-300 border border-emerald-500/30">
          <h3 className="text-xl font-bold text-emerald-400">🎁 Bonuses & Rewards</h3>
          <ul className="space-y-3">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">✓</span>
              <span><b>Welcome Bonus:</b> Get 30 Birr free (Bonus Balance) when you sign up!</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400">✓</span>
              <span><b>First Deposit 2X:</b> Your first deposit is doubled!</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-400">✓</span>
              <span><b>Referral Bonus:</b> Earn 20 Birr (Bonus Balance) for each friend you invite via the Bot!</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )

  const renderBingoHouseSelectPage = () => (
    <div className="h-screen bg-slate-900 text-white overflow-y-auto">
      <div className="w-full max-w-5xl mx-auto p-2 sm:p-4 space-y-2 sm:space-y-4">
        <div className="flex items-center justify-between py-1 sm:py-2">
          <button
            className="px-3 sm:px-4 py-1 sm:py-2 rounded bg-slate-800 hover:bg-slate-700 text-xs sm:text-sm"
            onClick={() => setCurrentPage('welcome')}
          >
            {t('back')}
          </button>
          <div className="text-lg sm:text-2xl font-bold">{t('select_bingo_house')}</div>
        </div>

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
                  <div>{t('active')}: {house.activePlayers} {t('players')}</div>
                  {house.waitingPlayers > 0 && <div>{t('waiting')}: {house.waitingPlayers} {t('players')}</div>}
                  <div>{t('prize')}: {house.prize} Birr</div>
                </div>
              <div className="mt-auto flex items-center justify-between gap-2">
                <button
                    className="px-2 sm:px-4 py-1.5 sm:py-2 rounded bg-black/30 hover:bg-black/40 font-semibold text-xs sm:text-sm flex-1"
                  onClick={() => {
                      handleJoinBetHouse(house.stake)
                  }}
                >
                    {isSelected ? t('go_lobby') : isLive ? t('join_wait') : t('play_now')}
                </button>
                  <div className="h-8 w-8 sm:h-12 sm:w-12 rounded-full bg-black/20 flex items-center justify-center text-sm sm:text-xl font-black flex-shrink-0">{config.tag}</div>
              </div>
            </div>
            )
          }) : (
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
                      }}
                    >
                      {t('play_now')}
                    </button>
                    <div className="h-8 w-8 sm:h-12 sm:w-12 rounded-full bg-black/20 flex items-center justify-center text-sm sm:text-xl font-black flex-shrink-0">{config.tag}</div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )


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
      <div className="h-screen bg-slate-900 text-white flex flex-col p-2 sm:p-4 overflow-hidden">
        <div className="w-full max-w-7xl mx-auto h-full flex flex-col">
          
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
                  setCurrentBetHouse(previousStake); setStake(previousStake); setCurrentPage('bingoHouseSelect') 
                } else {
                  setCurrentPage('welcome')
                }
              }}
              className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs sm:text-sm"
            >
              {t('close')}
            </button>
          </div>
  
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-orange-500 rounded-lg p-2 sm:p-4">
              <div className="text-[10px] opacity-90">{t('stake')}</div>
              <div className="text-sm sm:text-2xl font-bold">{stake} Birr</div>
            </div>
            <div className="bg-blue-600 rounded-lg p-2 sm:p-4">
              <div className="text-[10px] opacity-90">{t('players_label')}</div>
              <div className="text-sm sm:text-2xl font-bold">{players}</div>
            </div>
            <div className="bg-green-600 rounded-lg p-2 sm:p-4">
              <div className="text-[10px] opacity-90">{t('prize')}</div>
              <div className="text-sm sm:text-2xl font-bold">{prize} Birr</div>
            </div>
          </div>
  
          {lastCalled && (
            <div className="mb-3">
              <div className="w-full bg-slate-800/80 rounded-2xl px-3 sm:px-5 py-2 sm:py-3 border border-white/10 flex items-center justify-between gap-3 sm:gap-6">
                <div className="flex-1 text-[10px] sm:text-xs text-slate-200 uppercase tracking-wide">
                  {t('current_call')}
                  <div className="mt-0.5 text-[9px] sm:text-xs text-slate-400">
                    {numberToLetter(lastCalled)} {numberToWord(lastCalled)}
                  </div>
                  {phase === 'calling' && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-900/70 px-2 py-0.5 text-[9px] sm:text-xs text-emerald-300 border border-emerald-500/40">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{t('next_call_in')} {String(callCountdown).padStart(2, '0')}s</span>
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
                    {t('last_5')}
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
                        {t('waiting')}…
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-6 flex-1 min-h-0 mb-2">
            
            <div className="lg:col-span-2 bg-slate-800 rounded-2xl p-3 sm:p-5 flex flex-col min-h-0 shadow-2xl border border-white/5">
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-xl font-black text-white tracking-tight">{t('live_caller')}</h2>
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
  
              <div className="hidden lg:flex items-center gap-3 mt-4">
                <button
                  onClick={() => setAutoBingo(prev => !prev)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
                    autoBingo
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                      : 'bg-slate-700 border-slate-500 text-slate-200'
                  }`}
                >
                  {t('auto_bingo')}: {autoBingo ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => onPressBingo()}
                  disabled={autoAlgoMark ? false : !canBingo}
                  className={`flex-1 py-3 rounded text-lg font-bold ${
                    autoAlgoMark || canBingo ? 'bg-fuchsia-500 text-black' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {t('bingo_btn')}
                </button>
              </div>
            </div>
  
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-4 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs sm:text-sm font-semibold">{t('your_boards')}</div>
                <div className="text-[10px] text-slate-400">{picks.length}/2</div>
              </div>
  
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {picks.map((boardId) => (
                  <div key={boardId} className="bg-slate-700 rounded-lg p-2">
                    <div className="text-[10px] sm:text-sm text-slate-300 mb-1">Board {boardId}</div>
                    {renderCard(boardId, true)}
                  </div>
                ))}
              </div>
              
              <div className="mt-2 hidden sm:block text-[10px] text-slate-400 leading-tight">
                {t('tap_mark_hint')}
              </div>
            </div>
          </div>
  
          <div className="lg:hidden pb-1 space-y-2">
            <button
              onClick={() => setAutoBingo(prev => !prev)}
              className={`w-full py-2 rounded-lg text-sm font-semibold border ${
                autoBingo
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-slate-800 border-slate-500 text-slate-200'
              }`}
            >
              {t('auto_bingo')}: {autoBingo ? 'ON' : 'OFF'}
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
              {t('bingo_btn')}
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
            <div className="text-xl sm:text-2xl font-bold">{t('confirm_withdraw')}</div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-700">
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">{t('withdraw_amount')}</div>
              <div className="text-xl sm:text-2xl font-bold">{withdrawalAmount} Birr</div>
            </div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-700">
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">{t('your_account')}</div>
              <div className="text-sm sm:text-lg font-mono break-all">{withdrawalAccount}</div>
            </div>
            <div className="space-y-1 sm:space-y-2">
              <div className="text-xs sm:text-sm text-slate-300">{t('paste_withdraw_msg')}</div>
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
                  
                  const detectedAmount = parseAmount(withdrawalMessage)
                  if (!detectedAmount || Math.abs(detectedAmount - amountNum) > 0.01) {
                    alert('Amount in confirmation message does not match withdrawal amount')
                    setWithdrawalVerifying(false)
                    return
                  }
                  
                  const transactionId = parseTransactionId(withdrawalMessage)
                  if (!transactionId) {
                    alert('Transaction ID not found in confirmation message')
                    setWithdrawalVerifying(false)
                    return
                  }
                  
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
              {withdrawalVerifying ? t('verifying') : t('verify_withdraw')}
            </button>
            <div>
              <button className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-800 rounded text-xs sm:text-sm" onClick={() => setCurrentWithdrawalPage('form')}>{t('back')}</button>
            </div>
          </div>
        </div>
      )
    }
    
    return (
      <div className="h-screen bg-slate-900 text-white flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div className="w-full max-w-3xl space-y-3 sm:space-y-4">
          <div className="text-xl sm:text-2xl font-bold">{t('withdraw_funds')}</div>
          <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-slate-700">
            <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">{t('available_balance')}</div>
            <div className="text-2xl sm:text-3xl font-bold">{balance} Birr</div>
            <div className="text-xs text-orange-400 mt-1">Note: Bonus balance ({bonus} Birr) is not withdrawable.</div>
          </div>
          <div className="space-y-2 sm:space-y-3">
            <div>
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">{t('withdraw_amount')}</div>
              <input
                type="number"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
                placeholder="Enter amount in Birr"
                className="w-full bg-slate-800 rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-700 outline-none text-sm sm:text-base"
              />
            </div>
            <div>
              <div className="text-slate-300 text-xs sm:text-sm mb-1 sm:mb-2">{t('your_account_num')}</div>
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
                  alert('Insufficient withdrawable balance')
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
                  
                  setCurrentWithdrawalPage('confirm')
                  alert('Withdrawal request submitted! Please check your account and paste the confirmation message.')
                } catch (e: any) {
                  alert(e?.message || 'Failed to process withdrawal request')
                } finally {
                  setWithdrawalVerifying(false)
                }
              }}
            >
              {withdrawalVerifying ? t('loading') : t('request_withdraw')}
            </button>
          </div>
          <div className="mt-4 sm:mt-6">
            <div className="text-lg sm:text-xl font-semibold mb-1 sm:mb-2">{t('how_to_withdraw')}</div>
            <div className="bg-slate-800 rounded-lg sm:rounded-xl p-3 sm:p-4 text-slate-300 text-xs sm:text-sm space-y-1 sm:space-y-2">
              <p>1. Enter the amount you want to withdraw (must be less than or equal to your balance).</p>
              <p>2. Enter your account number where you want to receive the funds.</p>
              <p>3. Click "Request Withdrawal" to submit your request.</p>
              <p>4. After we process your withdrawal, you will receive a confirmation message.</p>
              <p>5. Paste the confirmation message to verify the withdrawal was successful.</p>
            </div>
          </div>
          <div>
            <button className="px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-800 rounded text-xs sm:text-sm" onClick={() => setCurrentPage('welcome')}>{t('back')}</button>
          </div>
        </div>
      </div>
    )
  }

  // Redirect to login if not authenticated (except for login page)
  if (!isAuthenticated && currentPage !== 'login') {
    return renderLoginPage()
  }

  // CORE RENDER LOGIC
  const mainPage =
    currentPage === 'login' ? renderLoginPage()
    : currentPage === 'welcome' ? renderWelcomePage()
    : currentPage === 'instructions' ? renderInstructionsPage()
    : currentPage === 'depositSelect' ? renderDepositSelect()
    : currentPage === 'depositConfirm' ? renderDepositConfirm()
    : currentPage === 'withdrawal' ? renderWithdrawalPage()
    : currentPage === 'bingoHouseSelect' ? renderBingoHouseSelectPage() 
    : currentPage === 'lobby' ? renderLobbyPage()
    : renderGamePage()

  return (
    <>
      {/* Add loading overlay for Telegram login */}
      {loginLoading && currentPage === 'login' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-emerald-500 mx-auto mb-4"></div>
            <p className="text-white text-lg">Signing you in...</p>
          </div>
        </div>
      )}
      
      {/* Rest of your app */}
      {!loginLoading && mainPage}
      
      {winnerInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md bg-slate-900 rounded-2xl border border-emerald-400/40 shadow-2xl p-4 sm:p-6 space-y-4">
            <div className="text-lg sm:text-2xl font-bold text-emerald-300">
              {t('bingo_btn')}
            </div>
            <div className="text-xs sm:text-sm text-slate-300 space-y-1">
              {winnerInfo.playerId && (
                <div>
                  <span className="text-slate-500">{t('winner')}:</span>{' '}
                  <span className="font-mono break-all">{winnerInfo.playerId}</span>
                </div>
              )}
              {typeof winnerInfo.prize === 'number' && (
                <div>
                  <span className="text-slate-500">{t('prize')}:</span>{' '}
                  <span className="font-semibold">{winnerInfo.prize} Birr</span>
                </div>
              )}
              {typeof winnerInfo.stake === 'number' && (
                <div>
                  <span className="text-slate-500">{t('stake')}:</span>{' '}
                  <span>{winnerInfo.stake} Birr</span>
                </div>
              )}
              <div>
                <span className="text-slate-500">{t('winning_board')}:</span>{' '}
                <span className="font-semibold">Board {winnerInfo.boardId}</span>
              </div>
            </div>

            {renderCard(winnerInfo.boardId, false, winnerInfo.lineIndices)}

            <div className="flex justify-end">
              <button
                onClick={() => setWinnerInfo(null)}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-black font-semibold text-sm sm:text-base"
              >
                {t('ok')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}