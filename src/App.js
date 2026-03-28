import React, { useState, useEffect } from 'react';
import { 
  Clock, LogOut, UserPlus, Users, List, CheckCircle, 
  LogIn, AlertCircle, Calendar, Download, Search, X, Trash2, History, Globe, Edit2, Filter
} from 'lucide-react';

// ==========================================
// 🔴 Firebase 雲端資料庫設定區
// ==========================================
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';

let firebaseConfig = {
  apiKey: "AIzaSyArHwxxCWehm40c6TSKBxm9A5pcHnjEZbE",
  authDomain: "check-in-ct.firebaseapp.com",
  projectId: "check-in-ct",
  storageBucket: "check-in-ct.firebasestorage.app",
  messagingSenderId: "475043764561",
  appId: "1:475043764561:web:f73138c945094bac435b70",
  measurementId: "G-8SZG6RW43L"
};

// 如果在 Canvas 預覽環境中，自動載入測試環境的資料庫
if (typeof __firebase_config !== 'undefined' && __firebase_config) {
  try {
    firebaseConfig = JSON.parse(__firebase_config);
  } catch (e) {
    console.warn("讀取測試環境資料庫失敗");
  }
}

// 加入防呆機制：使用 try-catch 包覆，避免金鑰不完整導致系統完全崩潰
let app, auth, db;
let isFirebaseInitialized = false;

try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app);
  isFirebaseInitialized = true;
} catch (error) {
  console.error("Firebase 初始化失敗！請檢查 firebaseConfig 是否填寫完整:", error);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'punch-system-dev';

// --- IP 驗證工具函數 (支援單一、多組、萬用字元與範圍) ---
const ipToInt = (ip) => {
  try {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  } catch (e) {
    return 0;
  }
};

const checkIpAllowed = (clientIp, allowedIPsString) => {
  if (!allowedIPsString || allowedIPsString.trim() === '') return true; // 空白代表不限制
  const rules = allowedIPsString.split(',').map(r => r.trim()).filter(r => r !== '');
  if (rules.length === 0) return true;

  for (let rule of rules) {
    // 1. 完全符合
    if (rule === clientIp) return true;
    
    // 2. 支援萬用字元 (例如: 192.168.1.*)
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1);
      if (clientIp.startsWith(prefix)) return true;
    }
    
    // 3. 支援範圍區間 (例如: 192.168.1.10-192.168.1.50)
    if (rule.includes('-')) {
      const parts = rule.split('-');
      if (parts.length === 2) {
        try {
          const clientInt = ipToInt(clientIp);
          const startInt = ipToInt(parts[0].trim());
          const endInt = ipToInt(parts[1].trim());
          if (clientInt >= startInt && clientInt <= endInt) return true;
        } catch(e) {}
      }
    }
  }
  return false; // 跑完所有規則都不符合，拒絕登入
};

// ==========================================
// 主程式入口
// ==========================================
export default function App() {
  // --- 狀態管理 ---
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  
  const [toast, setToast] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clientIp, setClientIp] = useState('讀取中...'); 
  const [adminView, setAdminView] = useState('records'); 

  // --- 初始化 0：安全載入 Tailwind CSS (避免模組解析衝突) ---
  useEffect(() => {
    if (typeof document !== 'undefined' && !document.getElementById('tailwind-script')) {
      const script = document.createElement('script');
      script.id = 'tailwind-script';
      script.src = 'https://cdn.tailwindcss.com';
      document.head.appendChild(script);
    }
  }, []);

  // --- 初始化 1：時鐘與 IP 取得 ---
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    try {
      fetch('https://api.ipify.org?format=json')
        .then(res => res.json())
        .then(data => setClientIp(data.ip))
        .catch(() => setClientIp('192.168.1.100 (模擬IP)'));
    } catch (e) {
      setClientIp('192.168.1.100 (模擬IP)');
    }
    return () => clearInterval(timer);
  }, []);

  // --- 初始化 2：Firebase 權限認證 ---
  useEffect(() => {
    if (!isFirebaseInitialized) return;

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Firebase登入失敗", err);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, user => {
      setFirebaseUser(user);
    });
    return () => unsubscribe();
  }, []);

  // --- 初始化 3：雲端資料庫雙向綁定 (監聽) ---
  useEffect(() => {
    if (!firebaseUser || !isFirebaseInitialized) return;

    const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_users');
    const recordsRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_records');

    const unsubUsers = onSnapshot(usersRef, (snapshot) => {
      if (snapshot.empty) {
        // 如果雲端是空的，自動建立預設帳號 (預設不限制 IP 方便測試)
        setDoc(doc(usersRef, 'admin_init'), { id: 'admin_init', username: 'admin', password: 'password', name: '系統管理員', role: 'admin', allowedIP: '' });
        setDoc(doc(usersRef, 'employee_init'), { id: 'employee_init', username: 'employee', password: 'password', name: '測試員工小明', role: 'employee', allowedIP: '' });
      } else {
        const loadedUsers = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
        setUsers(loadedUsers);
        setIsDataLoaded(true);
      }
    }, (err) => console.error("讀取使用者失敗", err));

    const unsubRecords = onSnapshot(recordsRef, (snapshot) => {
      const loadedRecords = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
      loadedRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setRecords(loadedRecords);
    }, (err) => console.error("讀取紀錄失敗", err));

    return () => {
      unsubUsers();
      unsubRecords();
    };
  }, [firebaseUser]);

  // ==========================================
  // 核心功能邏輯
  // ==========================================

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogin = (username, password, rememberMe) => {
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      // 支援多組 IP、區間與萬用字元驗證
      if (!checkIpAllowed(clientIp, user.allowedIP)) {
        showToast(`登入失敗！您的 IP (${clientIp}) 不在允許清單中。`, 'error');
        return;
      }
      
      setCurrentUser(user);
      if (user.role === 'admin') setAdminView('records');
      
      try {
        if (rememberMe) localStorage.setItem('punchSystemCredentials', JSON.stringify({ username, password }));
        else localStorage.removeItem('punchSystemCredentials');
      } catch (error) {
        console.warn('無法使用 localStorage');
      }
      showToast(`歡迎回來，${user.name}！`, 'success');
    } else {
      showToast('帳號或密碼錯誤！', 'error');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    showToast('已成功登出。', 'success');
  };

  const handlePunch = async (type) => {
    // 邏輯防護：檢查今天是否已經打過相同的卡
    const todayStr = new Date().toDateString();
    const hasPunchedToday = records.some(r => 
      r.userId === currentUser.id && 
      r.type === type && 
      new Date(r.timestamp).toDateString() === todayStr
    );

    if (hasPunchedToday) {
      showToast(`您今天已經打過${type === 'in' ? '上班' : '下班'}卡了！`, 'error');
      return;
    }

    try {
      const recordsRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_records');
      await addDoc(recordsRef, {
        id: Date.now().toString(),
        userId: currentUser.id,
        userName: currentUser.name,
        type: type, 
        timestamp: new Date().toISOString(),
      });
      showToast(type === 'in' ? '上班打卡成功！' : '下班打卡成功！', 'success');
    } catch (err) {
      showToast('網路錯誤，打卡失敗！', 'error');
    }
  };

  const handleAddUser = async (newUser) => {
    if (users.some(u => u.username === newUser.username)) {
      showToast('此帳號已存在，請更換帳號名稱！', 'error');
      return;
    }
    try {
      const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_users');
      await addDoc(usersRef, { ...newUser, id: Date.now().toString() });
      showToast(`成功新增員工：${newUser.name}`, 'success');
      setAdminView('users');
    } catch (err) {
      showToast('新增員工失敗！', 'error');
    }
  };

  const handleUpdateUserIP = async (docId, newIP) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId), { allowedIP: newIP });
      showToast(newIP ? `已更新 IP 限制規則` : '已解除該員工的 IP 限制', 'success');
    } catch (err) {
      showToast('更新 IP 失敗！', 'error');
    }
  };

  const handleDeleteUser = async (docId, userId, userName) => {
    if (userId === currentUser.id) {
      showToast('系統安全限制：您無法刪除目前的登入帳號！', 'error');
      return;
    }
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId));
      showToast(`已刪除員工：${userName}`, 'success');
    } catch (err) {
      showToast('刪除員工失敗！', 'error');
    }
  };

  // --- 畫面渲染邏輯 ---
  
  // 🔴 預防崩潰機制：如果 firebase 設定錯誤，顯示錯誤畫面而不是讓系統崩潰
  if (!isFirebaseInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4 animate-pulse" />
        <h2 className="text-2xl font-bold text-gray-800 tracking-wide mb-2">資料庫啟動失敗</h2>
        <p className="text-gray-600 text-center max-w-lg leading-relaxed bg-white p-6 rounded-xl shadow-sm border border-gray-200 mt-4">
          您的 <code className="bg-gray-100 px-1.5 py-0.5 rounded text-red-600 font-mono text-sm">firebaseConfig</code> 設定不完整，導致無法連線。
          <br /><br />
          👉 請回到 Firebase 控制台，複製<strong>完整</strong>的設定碼（包含 apiKey, projectId, <span className="text-red-600 font-bold">appId</span> 等所有欄位），並貼上覆蓋程式碼中的設定區塊。
        </p>
      </div>
    );
  }

  if (!isDataLoaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <Clock className="w-12 h-12 text-blue-600 animate-bounce mb-4" />
        <h2 className="text-xl font-bold text-gray-800 tracking-wide animate-pulse">正在連線至雲端資料庫...</h2>
        <p className="text-gray-500 mt-2 text-sm text-center">正在同步企業員工與打卡紀錄，請稍候。</p>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen onLogin={handleLogin} toast={toast} clientIp={clientIp} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-blue-600 flex-shrink-0">
            <Clock className="w-6 h-6 sm:w-7 sm:h-7" />
            <h1 className="font-bold text-lg sm:text-xl tracking-wide truncate hidden xs:block">
              企業打卡系統 <span className="text-[10px] text-emerald-600 border border-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-md ml-1 relative -top-0.5">雲端測試版</span>
            </h1>
          </div>
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="text-right flex flex-col items-end">
              <span className="font-bold text-gray-900 text-sm sm:text-base">{currentUser.name}</span>
              <span className="text-[10px] sm:text-xs bg-gray-100 px-2 py-0.5 rounded-full mt-0.5 text-gray-600 font-medium">
                {currentUser.role === 'admin' ? '管理員' : '一般員工'}
              </span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors flex-shrink-0"
              title="登出"
            >
              <LogOut className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed top-20 left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 z-50 animate-fade-in-down flex justify-center">
          <div className={`flex items-center w-full sm:w-auto px-4 sm:px-5 py-3 rounded-lg shadow-xl ${
            toast.type === 'success' ? 'bg-green-50 border-l-4 border-green-500 text-green-800' : 'bg-red-50 border-l-4 border-red-500 text-red-800'
          }`}>
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5 mr-2 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />}
            <p className="font-medium text-sm sm:text-base">{toast.message}</p>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {currentUser.role === 'admin' ? (
          <AdminDashboard 
            records={records} 
            users={users} 
            onAddUser={handleAddUser}
            onDeleteUser={handleDeleteUser}
            onUpdateUserIP={handleUpdateUserIP}
            view={adminView}
            setView={setAdminView}
            currentTime={currentTime}
            currentUser={currentUser}
            clientIp={clientIp}
            showToast={showToast}
          />
        ) : (
          <EmployeeDashboard 
            currentTime={currentTime} 
            records={records.filter(r => r.userId === currentUser.id)} 
            onPunch={handlePunch} 
            clientIp={clientIp}
          />
        )}
      </main>
    </div>
  );
}

// ==========================================
// 子元件：登入畫面
// ==========================================
function LoginScreen({ onLogin, toast, clientIp }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  useEffect(() => {
    try {
      const savedCredentials = localStorage.getItem('punchSystemCredentials');
      if (savedCredentials) {
        const { username: savedUsername, password: savedPassword } = JSON.parse(savedCredentials);
        setUsername(savedUsername);
        setPassword(savedPassword);
        setRememberMe(true);
      }
    } catch (e) {
      console.warn("無法存取 localStorage");
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username || !password) return;
    onLogin(username, password, rememberMe);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-200 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 p-6 sm:p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-blue-500 opacity-20 transform -skew-y-6 origin-top-left z-0"></div>
          <Clock className="w-12 h-12 sm:w-14 sm:h-14 text-white mx-auto mb-3 relative z-10 drop-shadow-md" />
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wider relative z-10">打卡系統登入</h2>
          <p className="text-blue-100 mt-1 sm:mt-2 text-xs sm:text-sm relative z-10">Employee Time Clock System</p>
        </div>
        
        <div className="p-6 sm:p-8">
          {toast && (
            <div className={`mb-6 p-3 sm:p-4 rounded-lg flex items-center text-sm ${toast.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
              <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
              {toast.message}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">帳號</label>
              <div className="relative">
                <Users className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                <input 
                  type="text" 
                  className="w-full pl-10 pr-4 py-2.5 sm:py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-base"
                  placeholder="輸入登入帳號"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">密碼</label>
              <div className="relative">
                <LogIn className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                <input 
                  type="password" 
                  className="w-full pl-10 pr-4 py-2.5 sm:py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-base"
                  placeholder="輸入密碼"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            
            <div className="flex items-center">
              <input
                id="remember-me"
                type="checkbox"
                className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <label htmlFor="remember-me" className="ml-2 block text-sm sm:text-base text-gray-700 cursor-pointer select-none">
                記住帳號與密碼
              </label>
            </div>

            <button 
              type="submit" 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 sm:py-3.5 px-4 rounded-lg flex items-center justify-center transition-all shadow-md hover:shadow-lg active:scale-95 text-base sm:text-lg"
            >
              登入系統
            </button>
          </form>

          <div className="mt-6 flex flex-col sm:flex-row justify-center items-center text-xs sm:text-sm text-gray-400 bg-gray-50 py-2 sm:py-3 px-2 rounded-lg border border-gray-100 text-center gap-1">
            <div className="flex items-center"><Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5" />目前網路 IP：</div>
            <span className="font-mono text-gray-600 break-all">{clientIp}</span>
          </div>
          
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 子元件：員工打卡首頁
// ==========================================
function EmployeeDashboard({ currentTime, records, onPunch, clientIp }) {
  const [activeTab, setActiveTab] = useState('today');

  const formatTime = (date) => date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const formatDate = (date) => date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  const todayStr = new Date().toDateString();
  const todayRecords = records.filter(r => new Date(r.timestamp).toDateString() === todayStr);

  // --- 新增：判斷今日是否已打過卡 (介面防護) ---
  const hasPunchedInToday = todayRecords.some(r => r.type === 'in');
  const hasPunchedOutToday = todayRecords.some(r => r.type === 'out');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* 巨型時鐘與打卡區塊 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-12 text-center relative overflow-hidden">
        <div className="sm:absolute sm:top-4 sm:left-4 inline-flex items-center text-[10px] sm:text-xs text-gray-500 bg-gray-50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-gray-200 mb-4 sm:mb-0">
          <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />
          IP: <span className="font-mono ml-1 text-gray-700">{clientIp}</span>
        </div>

        <h2 className="text-lg sm:text-xl text-gray-500 mb-2 sm:mb-3 mt-2 sm:mt-4">{formatDate(currentTime)}</h2>
        <div className="text-5xl sm:text-7xl font-mono font-bold text-gray-800 tracking-tight mb-8 sm:mb-10">
          {formatTime(currentTime)}
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 w-full">
          <button 
            onClick={() => onPunch('in')}
            disabled={hasPunchedInToday}
            className={`w-full sm:w-48 px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl font-bold text-lg sm:text-xl transition-all flex items-center justify-center ${
              hasPunchedInToday 
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' 
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl active:scale-95'
            }`}
          >
            <Clock className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
            {hasPunchedInToday ? '已上班' : '上班打卡'}
          </button>
          <button 
            onClick={() => onPunch('out')}
            disabled={hasPunchedOutToday}
            className={`w-full sm:w-48 px-6 sm:px-8 py-3.5 sm:py-4 rounded-xl font-bold text-lg sm:text-xl transition-all flex items-center justify-center ${
              hasPunchedOutToday 
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' 
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg hover:shadow-xl active:scale-95'
            }`}
          >
            <LogOut className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
            {hasPunchedOutToday ? '已下班' : '下班打卡'}
          </button>
        </div>
      </div>

      {/* 個人紀錄區塊 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('today')}
            className={`flex-1 py-3 sm:py-4 font-bold text-sm sm:text-base text-center transition-colors ${
              activeTab === 'today' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 inline-block mr-1.5 sm:mr-2 -mt-0.5 sm:-mt-1" />
            今日紀錄
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 sm:py-4 font-bold text-sm sm:text-base text-center transition-colors ${
              activeTab === 'history' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <History className="w-4 h-4 sm:w-5 sm:h-5 inline-block mr-1.5 sm:mr-2 -mt-0.5 sm:-mt-1" />
            歷史紀錄
          </button>
        </div>

        <div className="p-0">
          {activeTab === 'today' ? (
            todayRecords.length === 0 ? (
              <div className="text-center py-12 sm:py-16 text-gray-500 flex flex-col items-center">
                <List className="w-10 h-10 sm:w-12 sm:h-12 text-gray-300 mb-3" />
                <p className="text-sm sm:text-base">今日尚無打卡紀錄</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {todayRecords.map(record => (
                  <li key={record.docId} className="px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <div className="flex items-center">
                      <span className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full mr-3 sm:mr-4 ${record.type === 'in' ? 'bg-blue-500' : 'bg-emerald-500'}`}></span>
                      <span className="font-bold text-gray-800 text-base sm:text-lg">
                        {record.type === 'in' ? '上班' : '下班'}
                      </span>
                    </div>
                    <span className="text-gray-600 font-mono text-base sm:text-lg">
                      {new Date(record.timestamp).toLocaleTimeString('zh-TW')}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            records.length === 0 ? (
              <div className="text-center py-12 sm:py-16 text-gray-500 flex flex-col items-center">
                <History className="w-10 h-10 sm:w-12 sm:h-12 text-gray-300 mb-3" />
                <p className="text-sm sm:text-base">尚無任何歷史打卡紀錄</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <ul className="divide-y divide-gray-100">
                  {records.map(record => {
                    const d = new Date(record.timestamp);
                    return (
                      <li key={record.docId} className="px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 gap-1 sm:gap-0">
                        <div className="flex items-center">
                          <span className={`px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold mr-3 sm:mr-4 ${
                            record.type === 'in' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {record.type === 'in' ? '上班' : '下班'}
                          </span>
                          <span className="text-gray-800 font-medium text-sm sm:text-base">
                            {d.toLocaleDateString('zh-TW')}
                          </span>
                        </div>
                        <span className="text-gray-500 sm:text-gray-600 font-mono text-sm sm:text-base ml-12 sm:ml-0">
                          {d.toLocaleTimeString('zh-TW')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 子元件：管理員儀表板
// ==========================================
function AdminDashboard({ records, users, onAddUser, onDeleteUser, onUpdateUserIP, view, setView, currentTime, currentUser, clientIp, showToast }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 標籤選單 */}
      <div className="flex overflow-x-auto border-b border-gray-200 hide-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex space-x-1 sm:space-x-2 min-w-max pb-0.5">
          <button
            onClick={() => setView('records')}
            className={`flex items-center px-4 sm:px-6 py-3 font-bold text-sm sm:text-base rounded-t-xl transition-all whitespace-nowrap ${
              view === 'records' 
                ? 'bg-white text-blue-600 border-t border-l border-r border-gray-200 relative -mb-[1px] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]' 
                : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'
            }`}
          >
            <List className="w-4 h-4 mr-1.5 sm:mr-2" />
            全體紀錄
          </button>
          <button
            onClick={() => setView('users')}
            className={`flex items-center px-4 sm:px-6 py-3 font-bold text-sm sm:text-base rounded-t-xl transition-all whitespace-nowrap ${
              view === 'users' 
                ? 'bg-white text-blue-600 border-t border-l border-r border-gray-200 relative -mb-[1px] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]' 
                : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'
            }`}
          >
            <Users className="w-4 h-4 mr-1.5 sm:mr-2" />
            員工管理
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl sm:rounded-b-2xl sm:rounded-tr-2xl shadow-sm border border-gray-200 p-4 sm:p-8 overflow-hidden">
        {view === 'records' && <AdminRecordsView records={records} users={users} showToast={showToast} />}
        {view === 'users' && <AdminUsersView users={users} onAddUser={onAddUser} onDeleteUser={onDeleteUser} onUpdateUserIP={onUpdateUserIP} currentUser={currentUser} />}
      </div>
    </div>
  );
}

// --- 管理員：打卡紀錄列表 ---
function AdminRecordsView({ records, users, showToast }) {
  const getTodayString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [startDate, setStartDate] = useState(getTodayString());
  const [endDate, setEndDate] = useState(getTodayString());
  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState('');

  const filteredRecords = records.filter(record => {
    let matchDate = true;
    let matchUser = true;
    let matchType = true;

    const recordDateObj = new Date(record.timestamp);
    const year = recordDateObj.getFullYear();
    const month = String(recordDateObj.getMonth() + 1).padStart(2, '0');
    const day = String(recordDateObj.getDate()).padStart(2, '0');
    const recordDateStr = `${year}-${month}-${day}`;

    if (startDate && endDate) matchDate = recordDateStr >= startDate && recordDateStr <= endDate;
    else if (startDate) matchDate = recordDateStr >= startDate;
    else if (endDate) matchDate = recordDateStr <= endDate;

    if (filterUserId) matchUser = record.userId === filterUserId;
    if (filterType) matchType = record.type === filterType;
    
    return matchDate && matchUser && matchType;
  });

  const handleExportCSV = () => {
    if (filteredRecords.length === 0) return;
    try {
      const headers = ['員工姓名', '打卡類型', '日期', '時間'];
      const rows = filteredRecords.map(record => {
        const dateObj = new Date(record.timestamp);
        return [
          record.userName,
          record.type === 'in' ? '上班' : '下班',
          dateObj.toLocaleDateString('zh-TW'),
          dateObj.toLocaleTimeString('zh-TW')
        ];
      });

      const csvContent = '\uFEFF' + [headers, ...rows].map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      let dateStr = '全部';
      if(startDate && endDate) dateStr = `${startDate.replace(/-/g, '')}-${endDate.replace(/-/g, '')}`;
      else if(startDate) dateStr = `${startDate.replace(/-/g, '')}起`;
      else if(endDate) dateStr = `至${endDate.replace(/-/g, '')}`;

      link.setAttribute('download', `員工打卡紀錄_${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('報表匯出成功！', 'success');
    } catch (e) {
      showToast('匯出失敗，請確認裝置是否支援下載。', 'error');
    }
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setFilterUserId('');
    setFilterType('');
  };

  const setFilterToToday = () => {
    setStartDate(getTodayString());
    setEndDate(getTodayString());
  };

  return (
    <div className="animate-fade-in w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-3 sm:gap-4">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center">
          <List className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-blue-600" />
          明細查詢
        </h2>
        <button
          onClick={handleExportCSV}
          disabled={filteredRecords.length === 0}
          className={`flex items-center justify-center w-full sm:w-auto px-4 sm:px-5 py-2.5 rounded-lg font-bold transition-all text-sm sm:text-base ${
            filteredRecords.length === 0 
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md active:scale-95'
          }`}
        >
          <Download className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5 sm:mr-2" />
          匯出 CSV
        </button>
      </div>

      {/* 🟢 修正後的搜尋區塊 */}
      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 sm:p-5 mb-6 flex flex-col lg:flex-row gap-4 sm:gap-5">
        
        {/* 1. 日期區間 (手機版強制並排) */}
        <div className="flex-1 w-full">
          <label className="block text-sm font-bold text-gray-700 mb-1.5">
            日期區間 
            <button onClick={setFilterToToday} className="ml-2 text-xs text-blue-600 font-normal hover:underline">
              [ 今天 ]
            </button>
          </label>
          <div className="flex items-center gap-1.5 sm:gap-2 w-full">
            <div className="relative w-full">
              <input 
                type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-8 sm:pl-9 pr-1 sm:pr-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-xs sm:text-sm bg-white"
              />
              <Calendar className="w-4 h-4 text-gray-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2" />
            </div>
            <span className="text-gray-400 font-bold shrink-0">~</span>
            <div className="relative w-full">
              <input 
                type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate}
                className="w-full pl-8 sm:pl-9 pr-1 sm:pr-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-xs sm:text-sm bg-white"
              />
              <Calendar className="w-4 h-4 text-gray-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        </div>

        {/* 2. 員工與類型 (手機版強制並排) */}
        <div className="flex gap-3 sm:gap-4 flex-1 w-full lg:max-w-[400px]">
          <div className="flex-1 w-full min-w-0">
            <label className="block text-sm font-bold text-gray-700 mb-1.5 truncate">依員工查詢</label>
            <div className="relative">
              <select 
                value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}
                className="w-full pl-8 sm:pl-9 pr-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none shadow-sm bg-white text-xs sm:text-sm truncate"
              >
                <option value="">全部</option>
                {users.map(user => (
                  <option key={user.docId} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>

          <div className="flex-1 w-full min-w-0">
            <label className="block text-sm font-bold text-gray-700 mb-1.5 truncate">打卡類型</label>
            <div className="relative">
              <select 
                value={filterType} onChange={(e) => setFilterType(e.target.value)}
                className="w-full pl-8 sm:pl-9 pr-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none shadow-sm bg-white text-xs sm:text-sm"
              >
                <option value="">全部</option>
                <option value="in">上班</option>
                <option value="out">下班</option>
              </select>
              <Filter className="w-4 h-4 text-gray-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        </div>

        {/* 3. 清除按鈕 */}
        <div className="flex items-end w-full lg:w-auto mt-1 lg:mt-0">
          <button 
            onClick={clearFilters}
            className="w-full px-4 py-2 text-gray-600 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center font-bold text-sm shadow-sm whitespace-nowrap"
          >
            <X className="w-4 h-4 mr-1" />
            清除條件
          </button>
        </div>
      </div>
      
      {filteredRecords.length === 0 ? (
        <div className="text-center py-16 sm:py-20 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <List className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mb-3 sm:mb-4 mx-auto" />
          <p className="text-sm sm:text-lg px-4">
            {records.length === 0 
              ? '目前雲端資料庫中沒有任何打卡紀錄' 
              : '在這個日期區間內，找不到符合條件的打卡紀錄'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm w-full">
          <table className="w-full text-left border-collapse bg-white min-w-[500px]">
            <thead>
              <tr className="bg-gray-100/80 text-gray-700 text-xs sm:text-sm uppercase tracking-wider border-b border-gray-200">
                <th className="p-3 sm:p-4 font-bold whitespace-nowrap">員工姓名</th>
                <th className="p-3 sm:p-4 font-bold whitespace-nowrap">類型</th>
                <th className="p-3 sm:p-4 font-bold whitespace-nowrap">日期</th>
                <th className="p-3 sm:p-4 font-bold whitespace-nowrap">時間</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.map(record => {
                const dateObj = new Date(record.timestamp);
                return (
                  <tr key={record.docId} className="hover:bg-blue-50/50 transition-colors">
                    <td className="p-3 sm:p-4 font-bold text-gray-900 text-sm sm:text-base whitespace-nowrap">{record.userName}</td>
                    <td className="p-3 sm:p-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs sm:text-sm font-bold shadow-sm ${
                        record.type === 'in' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      }`}>
                        {record.type === 'in' ? '上班' : '下班'}
                      </span>
                    </td>
                    <td className="p-3 sm:p-4 text-gray-700 text-sm sm:text-base whitespace-nowrap">{dateObj.toLocaleDateString('zh-TW')}</td>
                    <td className="p-3 sm:p-4 text-gray-700 font-mono text-sm sm:text-lg whitespace-nowrap">{dateObj.toLocaleTimeString('zh-TW')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- 管理員：使用者管理與新增 ---
function AdminUsersView({ users, onAddUser, onDeleteUser, onUpdateUserIP, currentUser }) {
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('employee');
  const [newAllowedIP, setNewAllowedIP] = useState('');

  const [editingIpUserId, setEditingIpUserId] = useState(null);
  const [editIpValue, setEditIpValue] = useState('');
  const [userToDelete, setUserToDelete] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newUsername || !newPassword || !newName) return;
    onAddUser({ username: newUsername, password: newPassword, name: newName, role: newRole, allowedIP: newAllowedIP.trim() });
    setNewUsername(''); setNewPassword(''); setNewName(''); setNewRole('employee'); setNewAllowedIP('');
  };

  const startEditIp = (user) => { setEditingIpUserId(user.docId); setEditIpValue(user.allowedIP || ''); };
  const saveEditIp = (docId) => { onUpdateUserIP(docId, editIpValue.trim()); setEditingIpUserId(null); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 animate-fade-in relative">
      
      {/* 刪除確認 Modal */}
      {userToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl p-5 sm:p-6 max-w-sm w-full shadow-2xl animate-fade-in-down">
            <div className="flex items-center text-red-600 mb-3 sm:mb-4">
              <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
              <h3 className="text-lg sm:text-xl font-bold">確認刪除帳號</h3>
            </div>
            <p className="text-gray-600 mb-5 sm:mb-6 text-sm sm:text-base">確定要刪除「<span className="text-gray-900 font-bold">{userToDelete.name}</span>」嗎？此操作無法復原。</p>
            <div className="flex justify-end gap-2 sm:gap-3">
              <button onClick={() => setUserToDelete(null)} className="px-4 sm:px-5 py-2 sm:py-2.5 text-gray-600 font-bold hover:bg-gray-100 rounded-lg text-sm sm:text-base">取消</button>
              <button onClick={() => { onDeleteUser(userToDelete.docId, userToDelete.id, userToDelete.name); setUserToDelete(null); }} className="px-4 sm:px-5 py-2 sm:py-2.5 bg-red-600 text-white font-bold hover:bg-red-700 rounded-lg shadow-md text-sm sm:text-base">確定刪除</button>
            </div>
          </div>
        </div>
      )}

      {/* 員工列表 */}
      <div className="lg:col-span-2">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 sm:mb-6 flex items-center">
          <Users className="w-5 h-5 sm:w-6 sm:h-6 mr-2 text-blue-600" />
          目前系統員工 ({users.length})
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <ul className="divide-y divide-gray-100">
            {users.map(user => (
              <li key={user.docId} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 transition-colors gap-3 sm:gap-4">
                
                <div className="flex items-start sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm flex-shrink-0 mt-1 sm:mt-0 ${user.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>
                    {user.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <div className="font-bold text-gray-900 text-base sm:text-lg flex flex-wrap items-center gap-2">
                      <span className="truncate">{user.name}</span>
                      {user.id === currentUser.id && (
                        <span className="text-[10px] sm:text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full flex-shrink-0">您自己</span>
                      )}
                    </div>
                    <div className="text-xs sm:text-sm text-gray-500 mt-0.5 truncate">帳號: <span className="font-mono text-gray-700">{user.username}</span></div>
                    
                    {/* IP 編輯區塊 */}
                    <div className="text-[10px] sm:text-xs text-gray-500 mt-2 flex flex-col sm:flex-row sm:items-center bg-gray-100/80 p-2 sm:px-2 sm:py-1 rounded w-full sm:w-fit gap-2 sm:gap-0">
                      <div className="flex items-center">
                        <Globe className="w-3.5 h-3.5 mr-1 text-gray-400 flex-shrink-0" />
                        <span className="flex-shrink-0">IP限制:</span>
                      </div>
                      
                      {editingIpUserId === user.docId ? (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:ml-2 w-full">
                          <input
                            type="text" value={editIpValue} onChange={(e) => setEditIpValue(e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 text-xs w-full sm:w-48 focus:outline-none focus:border-blue-500 font-mono shadow-sm bg-white"
                            placeholder="支援單一,區間(-),萬用(*)" autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') saveEditIp(user.docId); if (e.key === 'Escape') setEditingIpUserId(null); }}
                          />
                          <div className="flex gap-1.5">
                            <button onClick={() => saveEditIp(user.docId)} className="flex-1 sm:flex-none text-white hover:bg-green-600 bg-green-500 px-2 py-1 rounded shadow-sm font-bold text-xs text-center">儲存</button>
                            <button onClick={() => setEditingIpUserId(null)} className="flex-1 sm:flex-none text-gray-600 hover:bg-gray-300 bg-gray-200 px-2 py-1 rounded shadow-sm font-bold text-xs text-center">取消</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center ml-1 sm:ml-0 mt-1 sm:mt-0">
                          {user.allowedIP ? (
                            <span className="sm:ml-1 text-blue-600 font-mono font-bold truncate max-w-[120px] sm:max-w-xs" title={user.allowedIP}>{user.allowedIP}</span>
                          ) : (
                            <span className="sm:ml-1 text-gray-400">無限制</span>
                          )}
                          <button onClick={() => startEditIp(user)} className="ml-2 text-blue-500 hover:text-blue-700 p-1 sm:p-0 bg-blue-50 sm:bg-transparent rounded" title="設定登入IP">
                            <Edit2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 右側按鈕區 */}
                <div className="flex items-center justify-end gap-3 w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-gray-100">
                  <span className={`text-[10px] sm:text-xs px-2.5 sm:px-3 py-1 rounded-full font-bold shadow-sm ${
                    user.role === 'admin' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}>
                    {user.role === 'admin' ? '管理員' : '一般員工'}
                  </span>
                  
                  <button 
                    onClick={() => setUserToDelete({ docId: user.docId, id: user.id, name: user.name })}
                    disabled={user.id === currentUser.id}
                    className={`p-1.5 sm:p-2 rounded-lg transition-colors ${
                      user.id === currentUser.id ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                    }`}
                  >
                    <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 新增員工表單 */}
      <div className="w-full">
        <div className="bg-blue-50/50 rounded-xl p-5 sm:p-6 border border-blue-100 lg:sticky lg:top-24 shadow-sm">
          <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 sm:mb-5 flex items-center">
            <UserPlus className="w-5 h-5 mr-2 text-blue-600" />
            新增員工帳號
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4 w-full">
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">員工姓名</label>
              <input type="text" required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：王大明"
                className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm sm:text-base" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">登入帳號</label>
              <input type="text" required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="建議使用英文數字"
                className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm sm:text-base" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">登入密碼</label>
              <input type="text" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="設定初始密碼"
                className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm sm:text-base" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">指定登入 IP (選填)</label>
              <input type="text" value={newAllowedIP} onChange={(e) => setNewAllowedIP(e.target.value)} placeholder="例: 192.168.1.1-192.168.1.50, 10.0.*"
                className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono text-xs sm:text-sm" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1">系統權限</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm sm:text-base" >
                <option value="employee">一般員工</option>
                <option value="admin">管理員</option>
              </select>
            </div>
            <button type="submit" className="w-full mt-2 sm:mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 sm:py-3 px-4 rounded-lg transition-all shadow-md active:scale-95 flex justify-center items-center text-sm sm:text-base">
              <UserPlus className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5 sm:mr-2" />
              建立新帳號
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
