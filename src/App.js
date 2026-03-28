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

if (typeof __firebase_config !== 'undefined' && __firebase_config) {
  try {
    firebaseConfig = JSON.parse(__firebase_config);
  } catch (e) {
    console.warn("讀取測試環境資料庫失敗");
  }
}

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

const ipToInt = (ip) => {
  try { return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0; } catch (e) { return 0; }
};

const checkIpAllowed = (clientIp, allowedIPsString) => {
  if (!allowedIPsString || allowedIPsString.trim() === '') return true; 
  const rules = allowedIPsString.split(',').map(r => r.trim()).filter(r => r !== '');
  if (rules.length === 0) return true;

  for (let rule of rules) {
    if (rule === clientIp) return true;
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1);
      if (clientIp.startsWith(prefix)) return true;
    }
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
  return false; 
};

// ==========================================
// 主程式入口
// ==========================================
export default function App() {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  
  const [toast, setToast] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clientIp, setClientIp] = useState('讀取中...'); 
  const [adminView, setAdminView] = useState('records'); 

  // --- 強制載入超時保險 (最多等 5 秒) ---
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isDataLoaded) {
        setIsDataLoaded(true);
        setLoadError("載入時間過長，可能是資料庫權限尚未開啟！");
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isDataLoaded]);

  // --- 初始化 0：安全載入 Tailwind CSS ---
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

    const unsubUsers = onSnapshot(usersRef, async (snapshot) => {
      if (snapshot.empty) {
        try {
          await setDoc(doc(usersRef, 'admin_init'), { id: 'admin_init', username: 'admin', password: 'password', name: '系統管理員', role: 'admin', allowedIP: '' });
          await setDoc(doc(usersRef, 'employee_init'), { id: 'employee_init', username: 'employee', password: 'password', name: '測試員工小明', role: 'employee', allowedIP: '' });
        } catch (err) {
          console.error("無法寫入預設帳號，請檢查 Firebase Firestore 規則", err);
        } finally {
          setIsDataLoaded(true); // 保證即使失敗也會解除載入畫面
        }
      } else {
        const loadedUsers = snapshot.docs.map(d => ({ ...d.data(), docId: d.id }));
        setUsers(loadedUsers);
        setIsDataLoaded(true);
      }
    }, (err) => {
      console.error("讀取使用者失敗", err);
      setLoadError("資料讀取失敗，請確認 Firebase 權限已設定為公開。");
      setIsDataLoaded(true); // 發生錯誤也強制解除載入畫面
    });

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

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogin = (username, password, rememberMe) => {
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
      if (!checkIpAllowed(clientIp, user.allowedIP)) {
        showToast(`登入失敗！您的 IP (${clientIp}) 不在允許清單中。`, 'error');
        return;
      }
      setCurrentUser(user);
      if (user.role === 'admin') setAdminView('records');
      try {
        if (rememberMe) localStorage.setItem('punchSystemCredentials', JSON.stringify({ username, password }));
        else localStorage.removeItem('punchSystemCredentials');
      } catch (error) {}
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
    const todayStr = new Date().toDateString();
    const hasPunchedToday = records.some(r => r.userId === currentUser.id && r.type === type && new Date(r.timestamp).toDateString() === todayStr);

    if (hasPunchedToday) {
      showToast(`您今天已經打過${type === 'in' ? '上班' : '下班'}卡了！`, 'error');
      return;
    }

    try {
      const recordsRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_records');
      await addDoc(recordsRef, { id: Date.now().toString(), userId: currentUser.id, userName: currentUser.name, type: type, timestamp: new Date().toISOString() });
      showToast(type === 'in' ? '上班打卡成功！' : '下班打卡成功！', 'success');
    } catch (err) {
      showToast('網路錯誤，打卡失敗！', 'error');
    }
  };

  const handleAddUser = async (newUser) => {
    if (users.some(u => u.username === newUser.username)) {
      showToast('此帳號已存在，請更換帳號名稱！', 'error'); return;
    }
    try {
      const usersRef = collection(db, 'artifacts', appId, 'public', 'data', 'punch_users');
      await addDoc(usersRef, { ...newUser, id: Date.now().toString() });
      showToast(`成功新增員工：${newUser.name}`, 'success');
      setAdminView('users');
    } catch (err) { showToast('新增員工失敗！', 'error'); }
  };

  const handleEditUser = async (docId, updatedData) => {
    if (users.some(u => u.username === updatedData.username && u.docId !== docId)) {
      showToast('此帳號名稱已存在，請更換！', 'error');
      return;
    }
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId), updatedData);
      showToast(`成功更新員工資料：${updatedData.name}`, 'success');
      if (currentUser.id === updatedData.id) {
        setCurrentUser({ ...currentUser, ...updatedData });
      }
    } catch (err) {
      showToast('更新員工資料失敗！', 'error');
    }
  };

  const handleUpdateUserIP = async (docId, newIP) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId), { allowedIP: newIP });
      showToast(newIP ? `已更新 IP 限制規則` : '已解除該員工的 IP 限制', 'success');
    } catch (err) { showToast('更新 IP 失敗！', 'error'); }
  };

  const handleDeleteUser = async (docId, userId, userName) => {
    if (userId === currentUser.id) { showToast('系統安全限制：您無法刪除目前的登入帳號！', 'error'); return; }
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_users', docId));
      showToast(`已刪除員工：${userName}`, 'success');
    } catch (err) { showToast('刪除員工失敗！', 'error'); }
  };

  // --- 新增：編輯/刪除打卡紀錄功能 ---
  const handleEditRecord = async (docId, newTimestamp) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_records', docId), { timestamp: newTimestamp });
      showToast('打卡時間更新成功！', 'success');
    } catch (err) {
      showToast('更新打卡時間失敗！', 'error');
    }
  };

  const handleDeleteRecord = async (docId) => {
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'punch_records', docId));
      showToast('已刪除該筆打卡紀錄', 'success');
    } catch (err) {
      showToast('刪除打卡紀錄失敗！', 'error');
    }
  };

  if (!isFirebaseInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4 animate-pulse" />
        <h2 className="text-2xl font-bold text-gray-800 tracking-wide mb-2">資料庫啟動失敗</h2>
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
    return (
      <>
        {loadError && (
          <div className="bg-red-50 text-red-600 p-3 text-center text-sm font-bold w-full absolute top-0 z-50">
            <AlertCircle className="w-4 h-4 inline mr-2" />
            {loadError}
          </div>
        )}
        <LoginScreen onLogin={handleLogin} toast={toast} clientIp={clientIp} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-blue-600 flex-shrink-0">
            <Clock className="w-6 h-6 sm:w-7 sm:h-7" />
            <h1 className="font-bold text-lg sm:text-xl tracking-wide truncate hidden xs:block">
              企業打卡系統
            </h1>
          </div>
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="text-right flex flex-col items-end">
              <span className="font-bold text-gray-900 text-sm sm:text-base">{currentUser.name}</span>
              <span className="text-[10px] sm:text-xs bg-gray-100 px-2 py-0.5 rounded-full mt-0.5 text-gray-600 font-medium">
                {currentUser.role === 'admin' ? '管理員' : '一般員工'}
              </span>
            </div>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors flex-shrink-0"><LogOut className="w-5 h-5 sm:w-6 sm:h-6" /></button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed top-20 left-4 right-4 sm:left-1/2 sm:right-auto sm:transform sm:-translate-x-1/2 z-50 animate-fade-in-down flex justify-center">
          <div className={`flex items-center w-full sm:w-auto px-4 sm:px-5 py-3 rounded-lg shadow-xl ${toast.type === 'success' ? 'bg-green-50 border-l-4 border-green-500 text-green-800' : 'bg-red-50 border-l-4 border-red-500 text-red-800'}`}>
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
            onEditUser={handleEditUser} 
            onDeleteUser={handleDeleteUser} 
            onUpdateUserIP={handleUpdateUserIP} 
            onEditRecord={handleEditRecord} 
            onDeleteRecord={handleDeleteRecord} // 傳遞刪除紀錄功能
            view={adminView} 
            setView={setAdminView} 
            currentTime={currentTime} 
            currentUser={currentUser} 
            clientIp={clientIp} 
            showToast={showToast} 
          />
        ) : (
          <EmployeeDashboard currentTime={currentTime} records={records.filter(r => r.userId === currentUser.id)} onPunch={handlePunch} clientIp={clientIp} />
        )}
      </main>
    </div>
  );
}

// ==========================================
// 子元件區塊 (登入 / 員工 / 管理員)
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
        setUsername(savedUsername); setPassword(savedPassword); setRememberMe(true);
      }
    } catch (e) {}
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username || !password) return;
    onLogin(username, password, rememberMe);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-200 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden mt-6">
        <div className="bg-blue-600 p-6 sm:p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-blue-500 opacity-20 transform -skew-y-6 origin-top-left z-0"></div>
          <Clock className="w-12 h-12 sm:w-14 sm:h-14 text-white mx-auto mb-3 relative z-10 drop-shadow-md" />
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wider relative z-10">打卡系統登入</h2>
          <p className="text-blue-100 mt-1 sm:mt-2 text-xs sm:text-sm relative z-10">Employee Time Clock System</p>
        </div>
        
        <div className="p-6 sm:p-8">
          {toast && (
            <div className={`mb-6 p-3 sm:p-4 rounded-lg flex items-center text-sm ${toast.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
              <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" /> {toast.message}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">帳號</label>
              <div className="relative">
                <Users className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                <input type="text" className="w-full pl-10 pr-4 py-2.5 sm:py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-base" placeholder="輸入登入帳號" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">密碼</label>
              <div className="relative">
                <LogIn className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                <input type="password" className="w-full pl-10 pr-4 py-2.5 sm:py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-base" placeholder="輸入密碼" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center">
              <input id="remember-me" type="checkbox" className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 rounded cursor-pointer" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
              <label htmlFor="remember-me" className="ml-2 block text-sm sm:text-base text-gray-700 cursor-pointer select-none">記住帳號與密碼</label>
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 sm:py-3.5 px-4 rounded-lg shadow-md active:scale-95 text-base sm:text-lg">登入系統</button>
          </form>

          <div className="mt-6 flex justify-center items-center text-xs sm:text-sm text-gray-400 bg-gray-50 py-2 sm:py-3 px-2 rounded-lg border border-gray-100">
            <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5" />目前網路 IP：<span className="font-mono text-gray-600 break-all ml-1">{clientIp}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmployeeDashboard({ currentTime, records, onPunch, clientIp }) {
  const [activeTab, setActiveTab] = useState('today');
  const formatTime = (date) => date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const formatDate = (date) => date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const todayStr = new Date().toDateString();
  const todayRecords = records.filter(r => new Date(r.timestamp).toDateString() === todayStr);
  const hasPunchedInToday = todayRecords.some(r => r.type === 'in');
  const hasPunchedOutToday = todayRecords.some(r => r.type === 'out');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-12 text-center relative overflow-hidden">
        <div className="sm:absolute sm:top-4 sm:left-4 inline-flex items-center text-[10px] sm:text-xs text-gray-500 bg-gray-50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-gray-200 mb-4 sm:mb-0">
          <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-1" />IP: <span className="font-mono ml-1 text-gray-700">{clientIp}</span>
        </div>
        <h2 className="text-lg sm:text-xl text-gray-500 mb-2 sm:mb-3 mt-2 sm:mt-4">{formatDate(currentTime)}</h2>
        <div className="text-5xl sm:text-7xl font-mono font-bold text-gray-800 tracking-tight mb-8 sm:mb-10">{formatTime(currentTime)}</div>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 w-full">
          <button onClick={() => onPunch('in')} disabled={hasPunchedInToday} className={`w-full sm:w-48 px-6 py-3.5 sm:py-4 rounded-xl font-bold text-lg sm:text-xl flex items-center justify-center ${hasPunchedInToday ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg active:scale-95'}`}>
            <Clock className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />{hasPunchedInToday ? '已上班' : '上班打卡'}
          </button>
          <button onClick={() => onPunch('out')} disabled={hasPunchedOutToday} className={`w-full sm:w-48 px-6 py-3.5 sm:py-4 rounded-xl font-bold text-lg sm:text-xl flex items-center justify-center ${hasPunchedOutToday ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg active:scale-95'}`}>
            <LogOut className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />{hasPunchedOutToday ? '已下班' : '下班打卡'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          <button onClick={() => setActiveTab('today')} className={`flex-1 py-3 sm:py-4 font-bold text-sm sm:text-base text-center transition-colors ${activeTab === 'today' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}>今日紀錄</button>
          <button onClick={() => setActiveTab('history')} className={`flex-1 py-3 sm:py-4 font-bold text-sm sm:text-base text-center transition-colors ${activeTab === 'history' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30' : 'text-gray-500 hover:bg-gray-50'}`}>歷史紀錄</button>
        </div>
        <div className="p-0">
          {activeTab === 'today' ? (
            todayRecords.length === 0 ? (
              <div className="text-center py-12 text-gray-500 flex flex-col items-center"><List className="w-10 h-10 text-gray-300 mb-3" /><p>今日尚無打卡紀錄</p></div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {todayRecords.map(record => (
                  <li key={record.docId} className="px-4 py-4 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center">
                      <span className={`w-2.5 h-2.5 rounded-full mr-3 ${record.type === 'in' ? 'bg-blue-500' : 'bg-emerald-500'}`}></span>
                      <span className="font-bold text-gray-800 text-base">{record.type === 'in' ? '上班' : '下班'}</span>
                    </div>
                    <span className="text-gray-600 font-mono text-base">{new Date(record.timestamp).toLocaleTimeString('zh-TW')}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            records.length === 0 ? (
              <div className="text-center py-12 text-gray-500 flex flex-col items-center"><History className="w-10 h-10 text-gray-300 mb-3" /><p>尚無任何歷史打卡紀錄</p></div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <ul className="divide-y divide-gray-100">
                  {records.map(record => {
                    const d = new Date(record.timestamp);
                    return (
                      <li key={record.docId} className="px-4 py-3 flex justify-between hover:bg-gray-50">
                        <div className="flex items-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold mr-3 ${record.type === 'in' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {record.type === 'in' ? '上班' : '下班'}
                          </span>
                          <span className="text-gray-800 font-medium text-sm">{d.toLocaleDateString('zh-TW')}</span>
                        </div>
                        <span className="text-gray-500 font-mono text-sm">{d.toLocaleTimeString('zh-TW')}</span>
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

function AdminDashboard({ records, users, onAddUser, onEditUser, onDeleteUser, onUpdateUserIP, onEditRecord, onDeleteRecord, view, setView, currentTime, currentUser, clientIp, showToast }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex overflow-x-auto border-b border-gray-200 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex space-x-1 sm:space-x-2 min-w-max pb-0.5">
          <button onClick={() => setView('records')} className={`flex items-center px-4 py-3 font-bold text-sm rounded-t-xl transition-all ${view === 'records' ? 'bg-white text-blue-600 border-t border-l border-r border-gray-200 relative -mb-[1px]' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'}`}><List className="w-4 h-4 mr-2" />全體紀錄</button>
          <button onClick={() => setView('users')} className={`flex items-center px-4 py-3 font-bold text-sm rounded-t-xl transition-all ${view === 'users' ? 'bg-white text-blue-600 border-t border-l border-r border-gray-200 relative -mb-[1px]' : 'text-gray-500 hover:text-gray-800 hover:bg-white/60 border-transparent border-t border-l border-r'}`}><Users className="w-4 h-4 mr-2" />員工管理</button>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-8 overflow-hidden">
        {view === 'records' && <AdminRecordsView records={records} users={users} showToast={showToast} onEditRecord={onEditRecord} onDeleteRecord={onDeleteRecord} />}
        {view === 'users' && <AdminUsersView users={users} onAddUser={onAddUser} onEditUser={onEditUser} onDeleteUser={onDeleteUser} onUpdateUserIP={onUpdateUserIP} currentUser={currentUser} />}
      </div>
    </div>
  );
}

function AdminRecordsView({ records, users, showToast, onEditRecord, onDeleteRecord }) {
  const getTodayString = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [startDate, setStartDate] = useState(getTodayString());
  const [endDate, setEndDate] = useState(getTodayString());
  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState('');
  
  // 狀態管理：編輯打卡紀錄
  const [editingRecord, setEditingRecord] = useState(null);
  const [editDateTime, setEditDateTime] = useState('');

  // 新增：狀態管理：刪除打卡紀錄
  const [recordToDelete, setRecordToDelete] = useState(null);

  const filteredRecords = records.filter(record => {
    let matchDate = true, matchUser = true, matchType = true;
    const d = new Date(record.timestamp);
    const recordDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      const rows = filteredRecords.map(r => [r.userName, r.type === 'in' ? '上班' : '下班', new Date(r.timestamp).toLocaleDateString('zh-TW'), new Date(r.timestamp).toLocaleTimeString('zh-TW')]);
      const csvContent = '\uFEFF' + [headers, ...rows].map(e => e.join(",")).join("\n");
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
      link.setAttribute('download', `打卡紀錄_${startDate || '全部'}.csv`);
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      showToast('報表匯出成功！', 'success');
    } catch (e) { showToast('匯出失敗', 'error'); }
  };

  const startEditRecord = (record) => {
    setEditingRecord(record);
    const d = new Date(record.timestamp);
    // 轉換為 YYYY-MM-DDThh:mm 格式讓 datetime-local input 吃得懂
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    setEditDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);
  };

  const handleSaveRecord = () => {
    if (!editDateTime) return;
    const newIsoString = new Date(editDateTime).toISOString();
    onEditRecord(editingRecord.docId, newIsoString);
    setEditingRecord(null);
  };

  return (
    <div className="animate-fade-in w-full">
      
      {/* 編輯打卡時間 Modal */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-sm animate-fade-in-down shadow-2xl">
            <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 flex items-center">
              <Edit2 className="w-5 h-5 mr-2 text-blue-600" />修改打卡時間
            </h3>
            <div className="mb-4 space-y-2">
              <p className="text-sm text-gray-600">員工：<span className="font-bold text-gray-900">{editingRecord.userName}</span></p>
              <p className="text-sm text-gray-600">類型：
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${editingRecord.type === 'in' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {editingRecord.type === 'in' ? '上班' : '下班'}
                </span>
              </p>
              <div className="pt-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">新的打卡時間</label>
                <input 
                  type="datetime-local" 
                  value={editDateTime} 
                  onChange={(e) => setEditDateTime(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" 
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
              <button onClick={() => setEditingRecord(null)} className="px-4 py-2 bg-gray-100 text-gray-600 font-bold rounded-lg text-sm hover:bg-gray-200 transition-colors">取消</button>
              <button onClick={handleSaveRecord} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg text-sm hover:bg-blue-700 shadow-md transition-colors">儲存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* 新增：刪除打卡紀錄確認 Modal */}
      {recordToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-sm animate-fade-in-down shadow-2xl">
            <h3 className="text-lg font-bold text-red-600 mb-3 flex items-center"><AlertCircle className="w-5 h-5 mr-2" />確認刪除紀錄</h3>
            <div className="mb-5 space-y-2">
              <p className="text-sm text-gray-600">確定要刪除這筆打卡紀錄嗎？</p>
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 mt-2">
                <p className="text-sm font-bold text-gray-800">{recordToDelete.userName}</p>
                <p className="text-xs text-gray-500 mt-1 flex items-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold mr-2 ${recordToDelete.type === 'in' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {recordToDelete.type === 'in' ? '上班' : '下班'}
                  </span>
                  {new Date(recordToDelete.timestamp).toLocaleString('zh-TW')}
                </p>
              </div>
              <p className="text-xs text-red-500 font-bold mt-2">※ 此操作將從雲端資料庫永久移除，無法復原！</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setRecordToDelete(null)} className="px-4 py-2 bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 rounded-lg text-sm">取消</button>
              <button onClick={() => { onDeleteRecord(recordToDelete.docId); setRecordToDelete(null); }} className="px-4 py-2 bg-red-600 text-white font-bold hover:bg-red-700 rounded-lg text-sm shadow-md">確定刪除</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between mb-4 sm:mb-6 gap-3">
        <h2 className="text-xl font-bold text-gray-800 flex items-center"><List className="w-5 h-5 mr-2 text-blue-600" />明細查詢</h2>
        <button onClick={handleExportCSV} disabled={filteredRecords.length === 0} className={`px-4 py-2.5 rounded-lg font-bold flex items-center ${filteredRecords.length === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}><Download className="w-4 h-4 mr-2" />匯出 CSV</button>
      </div>

      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 sm:p-5 mb-6 flex flex-col lg:flex-row gap-4">
        <div className="flex-1 w-full">
          <label className="block text-sm font-bold text-gray-700 mb-1.5">日期區間</label>
          <div className="flex items-center gap-1.5 w-full">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-2 py-2 border rounded-lg text-sm bg-white" />
            <span className="text-gray-400 font-bold shrink-0">~</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} className="w-full px-2 py-2 border rounded-lg text-sm bg-white" />
          </div>
        </div>

        <div className="flex gap-3 flex-1 w-full">
          <div className="flex-1">
            <label className="block text-sm font-bold text-gray-700 mb-1.5">員工</label>
            <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="w-full px-2 py-2 border rounded-lg bg-white text-sm">
              <option value="">全部</option>
              {/* 過濾掉管理員，只顯示一般員工 */}
              {users.filter(u => u.role !== 'admin').map(u => <option key={u.docId} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-bold text-gray-700 mb-1.5">類型</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full px-2 py-2 border rounded-lg bg-white text-sm"><option value="">全部</option><option value="in">上班</option><option value="out">下班</option></select>
          </div>
        </div>

        <div className="flex items-end w-full lg:w-auto">
          <button onClick={() => { setStartDate(''); setEndDate(''); setFilterUserId(''); setFilterType(''); }} className="w-full px-4 py-2 text-gray-600 bg-white border border-gray-300 hover:bg-gray-100 rounded-lg text-sm font-bold"><X className="w-4 h-4 inline mr-1" />清除</button>
        </div>
      </div>
      
      {filteredRecords.length === 0 ? (
        <div className="text-center py-16 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300"><List className="w-12 h-12 mx-auto text-gray-300 mb-3" /><p>找不到符合條件的打卡紀錄</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 w-full">
          <table className="w-full text-left bg-white min-w-[500px]">
            <thead>
              <tr className="bg-gray-100/80 text-gray-700 text-sm border-b">
                <th className="p-3 font-bold">員工</th>
                <th className="p-3 font-bold">類型</th>
                <th className="p-3 font-bold">日期</th>
                <th className="p-3 font-bold">時間</th>
                <th className="p-3 font-bold text-center w-24">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecords.map(r => (
                <tr key={r.docId} className="hover:bg-blue-50/50">
                  <td className="p-3 font-bold text-gray-900">{r.userName}</td>
                  <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-bold ${r.type === 'in' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{r.type === 'in' ? '上班' : '下班'}</span></td>
                  <td className="p-3 text-gray-700">{new Date(r.timestamp).toLocaleDateString('zh-TW')}</td>
                  <td className="p-3 text-gray-700 font-mono">{new Date(r.timestamp).toLocaleTimeString('zh-TW')}</td>
                  <td className="p-3 text-center whitespace-nowrap">
                    <button 
                      onClick={() => startEditRecord(r)} 
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" 
                      title="修改時間"
                    >
                      <Edit2 className="w-4 h-4 inline-block" />
                    </button>
                    <button 
                      onClick={() => setRecordToDelete(r)} 
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors ml-1" 
                      title="刪除紀錄"
                    >
                      <Trash2 className="w-4 h-4 inline-block" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminUsersView({ users, onAddUser, onEditUser, onDeleteUser, onUpdateUserIP, currentUser }) {
  const [newUsername, setNewUsername] = useState(''); const [newPassword, setNewPassword] = useState(''); const [newName, setNewName] = useState(''); const [newRole, setNewRole] = useState('employee'); const [newAllowedIP, setNewAllowedIP] = useState('');
  const [editingIpUserId, setEditingIpUserId] = useState(null); const [editIpValue, setEditIpValue] = useState(''); const [userToDelete, setUserToDelete] = useState(null);
  
  // 新增：編輯全功能資料的狀態管理
  const [editingUser, setEditingUser] = useState(null);
  const [editFormData, setEditFormData] = useState({ name: '', username: '', password: '', role: '', allowedIP: '', id: '' });

  const handleSubmit = (e) => {
    e.preventDefault(); if (!newUsername || !newPassword || !newName) return;
    onAddUser({ username: newUsername, password: newPassword, name: newName, role: newRole, allowedIP: newAllowedIP.trim() });
    setNewUsername(''); setNewPassword(''); setNewName(''); setNewRole('employee'); setNewAllowedIP('');
  };

  const startFullEdit = (user) => {
    setEditingUser(user);
    setEditFormData({
      id: user.id,
      name: user.name,
      username: user.username,
      password: user.password,
      role: user.role,
      allowedIP: user.allowedIP || ''
    });
  };

  const handleSaveEdit = () => {
    if (!editFormData.name || !editFormData.username || !editFormData.password) return;
    onEditUser(editingUser.docId, editFormData);
    setEditingUser(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in relative">
      
      {/* 編輯員工資料 Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-md animate-fade-in-down shadow-2xl">
            <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 flex items-center">
              <Edit2 className="w-5 h-5 mr-2 text-blue-600" />編輯員工資料
            </h3>
            <div className="space-y-3">
              <div><label className="block text-xs font-bold text-gray-700 mb-1">姓名</label><input type="text" required value={editFormData.name} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-xs font-bold text-gray-700 mb-1">登入帳號</label><input type="text" required value={editFormData.username} onChange={(e) => setEditFormData({...editFormData, username: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-xs font-bold text-gray-700 mb-1">登入密碼</label><input type="text" required value={editFormData.password} onChange={(e) => setEditFormData({...editFormData, password: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
              <div><label className="block text-xs font-bold text-gray-700 mb-1">IP 限制 (選填)</label><input type="text" value={editFormData.allowedIP} onChange={(e) => setEditFormData({...editFormData, allowedIP: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500" /></div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">權限</label>
                <select value={editFormData.role} onChange={(e) => setEditFormData({...editFormData, role: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                  <option value="employee">一般員工</option>
                  <option value="admin">管理員</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => setEditingUser(null)} className="px-4 py-2 bg-gray-100 text-gray-600 font-bold rounded-lg text-sm hover:bg-gray-200 transition-colors">取消</button>
              <button onClick={handleSaveEdit} className="px-4 py-2 bg-blue-600 text-white font-bold rounded-lg text-sm hover:bg-blue-700 shadow-md transition-colors">儲存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除確認 Modal */}
      {userToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-5 sm:p-6 w-full max-w-sm animate-fade-in-down shadow-2xl">
            <h3 className="text-lg font-bold text-red-600 mb-3 flex items-center"><AlertCircle className="w-5 h-5 mr-2" />確認刪除帳號</h3>
            <p className="mb-5 text-sm text-gray-600">確定要刪除「<span className="font-bold text-gray-900">{userToDelete.name}</span>」嗎？此操作無法復原。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setUserToDelete(null)} className="px-4 py-2 bg-gray-100 font-bold text-gray-600 hover:bg-gray-200 rounded-lg text-sm">取消</button>
              <button onClick={() => { onDeleteUser(userToDelete.docId, userToDelete.id, userToDelete.name); setUserToDelete(null); }} className="px-4 py-2 bg-red-600 text-white font-bold hover:bg-red-700 rounded-lg text-sm shadow-md">確定刪除</button>
            </div>
          </div>
        </div>
      )}

      <div className="lg:col-span-2">
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center"><Users className="w-5 h-5 mr-2 text-blue-600" />系統員工 ({users.length})</h2>
        <div className="bg-white border rounded-xl overflow-hidden shadow-sm">
          <ul className="divide-y divide-gray-100">
            {users.map(u => (
              <li key={u.docId} className="p-4 flex flex-col sm:flex-row justify-between gap-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-start sm:items-center gap-3 w-full">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 mt-1 sm:mt-0 ${u.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}`}>{u.name.charAt(0)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 text-base flex flex-wrap items-center gap-2">
                      <span className="truncate">{u.name}</span>
                      {u.id === currentUser.id && <span className="text-[10px] bg-gray-200 px-2 py-0.5 rounded-full shrink-0 text-gray-600">您自己</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">帳號: <span className="font-mono text-gray-700">{u.username}</span></div>
                    
                    <div className="text-[10px] sm:text-xs text-gray-500 mt-2 flex flex-col sm:flex-row sm:items-center bg-gray-100/80 px-2 py-1 rounded w-full sm:w-fit gap-2 sm:gap-0">
                      <div className="flex items-center shrink-0">
                        <Globe className="w-3.5 h-3.5 mr-1" /> IP限制: 
                      </div>
                      {editingIpUserId === u.docId ? (
                        <div className="flex sm:ml-2 w-full"><input type="text" value={editIpValue} onChange={(e) => setEditIpValue(e.target.value)} className="border rounded px-1 text-xs w-full sm:w-32 focus:outline-none focus:border-blue-500" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { onUpdateUserIP(u.docId, editIpValue.trim()); setEditingIpUserId(null); } if (e.key === 'Escape') setEditingIpUserId(null); }} /><button onClick={() => { onUpdateUserIP(u.docId, editIpValue.trim()); setEditingIpUserId(null); }} className="ml-1 bg-green-500 hover:bg-green-600 text-white px-2 py-0.5 rounded text-xs font-bold">儲存</button><button onClick={() => setEditingIpUserId(null)} className="ml-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-0.5 rounded text-xs font-bold">取消</button></div>
                      ) : (
                        <div className="flex items-center ml-1 sm:ml-2">
                          {u.allowedIP ? <span className="text-blue-600 font-mono font-bold truncate max-w-[120px] sm:max-w-[150px]">{u.allowedIP}</span> : <span className="text-gray-400">無限制</span>}
                          <button onClick={() => { setEditingIpUserId(u.docId); setEditIpValue(u.allowedIP || ''); }} className="ml-2 text-blue-500 hover:text-blue-700 p-0.5" title="快速修改 IP"><Edit2 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-end gap-2 pt-2 sm:pt-0 mt-2 sm:mt-0 border-t border-gray-100 sm:border-0 w-full sm:w-auto">
                  <span className={`text-[10px] px-2 py-1 rounded-full font-bold mr-2 ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>{u.role === 'admin' ? '管理員' : '一般員工'}</span>
                  
                  {/* 新增的編輯按鈕 */}
                  <button onClick={() => startFullEdit(u)} className="p-1.5 sm:p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="編輯帳號資料">
                    <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  
                  <button onClick={() => setUserToDelete({ docId: u.docId, id: u.id, name: u.name })} disabled={u.id === currentUser.id} className={`p-1.5 sm:p-2 rounded-lg transition-colors ${u.id === currentUser.id ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`} title="刪除帳號">
                    <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="w-full">
        <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100 lg:sticky lg:top-24 shadow-sm">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><UserPlus className="w-5 h-5 mr-2 text-blue-600" />新增帳號</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="block text-xs font-bold text-gray-700 mb-1">姓名</label><input type="text" required value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-xs font-bold text-gray-700 mb-1">帳號</label><input type="text" required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-xs font-bold text-gray-700 mb-1">密碼</label><input type="text" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-xs font-bold text-gray-700 mb-1">IP 限制 (選填)</label><input type="text" value={newAllowedIP} onChange={(e) => setNewAllowedIP(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-xs font-bold text-gray-700 mb-1">權限</label><select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"><option value="employee">一般員工</option><option value="admin">管理員</option></select></div>
            <button type="submit" className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg flex justify-center text-sm shadow-md active:scale-95 transition-all"><UserPlus className="w-4 h-4 mr-2" />建立帳號</button>
          </form>
        </div>
      </div>
    </div>
  );
}
