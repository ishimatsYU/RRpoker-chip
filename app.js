// グローバル変数
let currentUser = null;
let currentUserData = null;
let pendingWithdraw = null; // 引き出し待機中のデータ
let prizeWinnersCount = 0; // トーナメントプライズ用

/* =========================
   ローカルDB（localStorage）実装
   - このプロジェクトはサーバ/API未実装のため、
     ブラウザ内の localStorage を簡易DBとして使用します。
   ========================= */

const DB_KEY = 'RR_CHIP_DB_V1';

function _loadDB() {
    try {
        const raw = localStorage.getItem(DB_KEY);
        if (!raw) return { users: [], chips: [], requests: [], tournaments: [], tournament_results: [], rake_history: [] };
        const db = JSON.parse(raw);
        // テーブルが無い場合に備えて補完
        return {
            users: db.users ?? [],
            chips: db.chips ?? [],
            requests: db.requests ?? [],
            tournaments: db.tournaments ?? [],
            tournament_results: db.tournament_results ?? [],
            rake_history: db.rake_history ?? []
        };
    } catch (e) {
        console.error('DB読み込み失敗。初期化します:', e);
        return { users: [], chips: [], requests: [], tournaments: [], tournament_results: [], rake_history: [] };
    }
}

function _saveDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function _newId() {
    // Safari 等で crypto.randomUUID が無いケースも考慮
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * テーブル全取得
 * @param {string} table
 * @returns {Promise<Array>}
 */
async function fetchData(table) {
    const db = _loadDB();
    if (!db[table]) db[table] = [];
    return db[table];
}

/**
 * 単一取得
 * - id 指定 or "field=value&field2=value2" のクエリ形式に対応（簡易）
 */
async function fetchSingleRecord(table, id = null, query = null) {
    const rows = await fetchData(table);
    if (id) return rows.find(r => r.id === id) ?? null;

    if (!query) return rows[0] ?? null;

    const conditions = query.split('&').map(s => s.trim()).filter(Boolean).map(pair => {
        const [k, v] = pair.split('=');
        return { key: k, value: v };
    });

    return rows.find(r => conditions.every(c => String(r[c.key]) === String(c.value))) ?? null;
}

/**
 * 作成
 */
async function createRecord(table, data) {
    const db = _loadDB();
    if (!db[table]) db[table] = [];
    const record = { id: _newId(), ...data };
    db[table].push(record);
    _saveDB(db);
    return record;
}

/**
 * 更新（部分更新）
 */
async function updateRecord(table, id, patch) {
    const db = _loadDB();
    if (!db[table]) db[table] = [];
    const idx = db[table].findIndex(r => r.id === id);
    if (idx === -1) return null;
    db[table][idx] = { ...db[table][idx], ...patch };
    _saveDB(db);
    return db[table][idx];
}

/**
 * 削除
 */
async function deleteRecord(table, id) {
    const db = _loadDB();
    if (!db[table]) db[table] = [];
    const before = db[table].length;
    db[table] = db[table].filter(r => r.id !== id);
    _saveDB(db);
    return db[table].length !== before;
}

/**
 * 初期データ（テストユーザー）
 */
async function seedDemoDataIfNeeded() {
    const users = await fetchData('users');
    const testExists = users.find(u => u.username === 'testuser1');
    if (!testExists) {
        const testUser = await createRecord('users', {
            username: 'testuser1',
            password: 'test123',
            name: 'テストユーザー1',
            role: 'customer',
            created_at: Date.now()
        });
        await createRecord('chips', {
            user_id: testUser.id,
            balance: 0,
            created_at: Date.now(),
            updated_at: Date.now()
        });
        console.log('デモユーザーを作成しました: testuser1 / test123');
    }
}

// 初期化
document.addEventListener('DOMContentLoaded', async function() {
    console.log('RRチップ管理システム 初期化開始');
    try {
        await seedDemoDataIfNeeded();
        showInitialScreen();
        await initializeAdminAccount();
    } catch (error) {
        console.error('初期化エラー:', error);
    }
});

// 初期画面表示
function showInitialScreen() {
    hideAllScreens();
    document.getElementById('initialScreen').classList.remove('hidden');
}

// すべての画面を非表示
function hideAllScreens() {
    document.getElementById('initialScreen').classList.add('hidden');
    document.getElementById('createAccountScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('customerDashboard').classList.add('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('withdrawForm').classList.add('hidden');
    document.getElementById('depositForm').classList.add('hidden');
    document.getElementById('withdrawConfirm').classList.add('hidden');
    document.getElementById('rankingScreen').classList.add('hidden');
    document.getElementById('chipManagementScreen').classList.add('hidden');
    document.getElementById('transactionHistoryScreen').classList.add('hidden');
    document.getElementById('tournamentRankingScreen').classList.add('hidden');
    document.getElementById('tournamentScheduleScreen').classList.add('hidden');
    document.getElementById('tournamentManagementScreen').classList.add('hidden');
    document.getElementById('tournamentPrizeScreen').classList.add('hidden');
    document.getElementById('customerBottomNav').classList.add('hidden');
}

// アカウント作成画面表示
function showCreateAccount() {
    hideAllScreens();
    document.getElementById('createAccountScreen').classList.remove('hidden');
}

// ログイン画面表示
function showLogin() {
    hideAllScreens();
    document.getElementById('loginScreen').classList.remove('hidden');
}

// 初期画面に戻る
function backToInitial() {
    showInitialScreen();
}

async function createAccount() {
    const pokerName = document.getElementById('newUsername').value.trim(); // ←ポーカーネーム
    const password = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!pokerName || !password) {
        alert('ポーカーネームとパスワードを入力してください。');
        return;
    }

    if (password !== confirmPassword) {
        alert('パスワードが一致しません。');
        return;
    }

    if (pokerName.includes(' ')) {
        alert('ポーカーネームに空白文字は使用できません。');
        return;
    }

    try {
        const existingUsers = await fetchData('users');
        if (existingUsers.find(u => u.username === pokerName)) {
            alert('このポーカーネームは既に使用されています。');
            return;
        }

        const userData = {
            username: pokerName, // ←username欄にポーカーネームを入れておく（他のコードが楽）
            password: password,
            name: pokerName,     // ←表示名も同じにする（互換性のため）
            role: 'customer',
            created_at: Date.now()
        };

        const newUser = await createRecord('users', userData);

        await createRecord('chips', {
            user_id: newUser.id,
            balance: 0,
            created_at: Date.now(),
            updated_at: Date.now()
        });

        alert('アカウントを作成しました。ログインしてください。');

        // フォームをクリア
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';

        showLogin();
    } catch (error) {
        console.error('アカウント作成エラー:', error);
        alert('アカウント作成に失敗しました。');
    }
}


// ログイン処理
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
        alert('ユーザー名とパスワードを入力してください。');
        return;
    }

    try {
        const users = await fetchData('users');
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
            currentUser = user;
            
            // チップデータを読み込む
            const chipData = await fetchSingleRecord('chips', null, `user_id=${user.id}`);
            if (chipData) {
                currentUserData = chipData;
            } else {
                // チップデータがない場合は作成
                const newChipData = {
                    user_id: user.id,
                    balance: 0,
                    created_at: Date.now(),
                    updated_at: Date.now()
                };
                currentUserData = await createRecord('chips', newChipData);
            }

            alert(`ようこそ、${user.name}さん`);
            
            if (user.role === 'admin') {
                showAdminDashboard();
            } else {
                showCustomerDashboard();
            }
        } else {
            alert('ユーザー名またはパスワードが正しくありません。');
        }
    } catch (error) {
        console.error('ログインエラー:', error);
        alert('ログインに失敗しました。');
    }
}

// 顧客ダッシュボード表示
function showCustomerDashboard() {
    hideAllScreens();
    document.getElementById('customerDashboard').classList.remove('hidden');
    document.getElementById('customerBottomNav').classList.remove('hidden');
    document.getElementById('customerName').textContent = currentUser.name;
    document.getElementById('customerId').textContent = `@${currentUser.username}`;
    document.getElementById('chipBalance').textContent = currentUserData.balance.toLocaleString();
    showCustomerBottomNav();
    loadTransactionHistory();
}

// 管理者ダッシュボード表示
async function showAdminDashboard() {
    hideAllScreens();
    document.getElementById('adminDashboard').classList.remove('hidden');
    await loadAdminData();
}

// 管理者データ読み込み
async function loadAdminData() {
    try {
        // 承認待ち入金申請を読み込む
        const requests = await fetchData('requests');
        const pendingRequests = requests.filter(r => r.type === 'deposit' && r.status === 'pending');
        
        const pendingContainer = document.getElementById('pendingRequests');
        pendingContainer.innerHTML = '';

        if (pendingRequests.length === 0) {
            pendingContainer.innerHTML = '<p class="text-gray-400 text-center">承認待ちの入金申請はありません</p>';
        } else {
            for (const request of pendingRequests) {
                const user = await fetchSingleRecord('users', request.user_id);
                if (user) {
                    const requestItem = document.createElement('div');
                    requestItem.className = 'glass-card p-3';
                    requestItem.innerHTML = `
                        <div class="flex justify-between items-center">
                            <div>
                                <p class="text-white font-semibold">${user.name}</p>
                                <p class="text-gray-400 text-sm">@${user.username}</p>
                                <p class="text-yellow-400">${request.amount.toLocaleString()} チップ</p>
                            </div>
                            <div class="flex space-x-2">
                                <button onclick="approveRequest('${request.id}')" class="bg-green-600 text-white px-3 py-1 rounded text-sm">
                                    承認
                                </button>
                                <button onclick="rejectRequest('${request.id}')" class="bg-red-600 text-white px-3 py-1 rounded text-sm">
                                    却下
                                </button>
                            </div>
                        </div>
                    `;
                    pendingContainer.appendChild(requestItem);
                }
            }
        }

        // ユーザーリストを更新
        const users = await fetchData('users');
        const userSelect = document.getElementById('selectUserForChip');
        userSelect.innerHTML = '<option value="">ユーザーを選択</option>';
        
        for (const user of users) {
            if (user.role === 'customer') {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = `${user.name} (@${user.username})`;
                userSelect.appendChild(option);
            }
        }

        // 全顧客のチップ状況を読み込む
        const allCustomersContainer = document.getElementById('allCustomers');
        allCustomersContainer.innerHTML = '';

        for (const user of users) {
            if (user.role === 'customer') {
                const chipData = await fetchSingleRecord('chips', null, `user_id=${user.id}`);
                const balance = chipData ? chipData.balance : 0;
                
                const customerItem = document.createElement('div');
                customerItem.className = 'glass-card p-3';
                customerItem.innerHTML = `
                    <div class="flex justify-between items-center">
                        <div>
                            <p class="text-white font-semibold">${user.name}</p>
                            <p class="text-gray-400 text-sm">@${user.username}</p>
                        </div>
                        <p class="text-yellow-400 font-bold">${balance.toLocaleString()}</p>
                    </div>
                `;
                allCustomersContainer.appendChild(customerItem);
            }
        }

        // レーキ合計を更新
        await updateRakeTotal();
    } catch (error) {
        console.error('管理者データ読み込みエラー:', error);
    }
}

// ログアウト
function logout() {
    currentUser = null;
    currentUserData = null;
    showInitialScreen();
}

// 新しい画面表示関数
function showTransactionHistory() {
    hideAllScreens();
    document.getElementById('transactionHistoryScreen').classList.remove('hidden');
    showCustomerBottomNav();

    loadTransactionHistory();
}

function hideTransactionHistory() {
    showCustomerDashboard();
}

// 取引履歴を読み込む（プライズ対応版）
async function loadTransactionHistory() {
    try {
        const requests = await fetchData('requests');
        const userRequests = requests.filter(r => r.user_id === currentUser.id);

        // ★追加：トーナメント名を履歴に表示するための準備
        const tournaments = await fetchData('tournaments');
        const tournamentMap = new Map(tournaments.map(t => [t.id, t.name]));

        // 日付順にソート（新しい順）
        userRequests.sort((a, b) => b.created_at - a.created_at);

        const historyContainer = document.getElementById('transactionHistoryList');
        historyContainer.innerHTML = '';

        if (userRequests.length === 0) {
            historyContainer.innerHTML = '<p class="text-gray-400 text-center">取引履歴がありません</p>';
            return;
        }

        for (const request of userRequests) {
            const date = new Date(request.created_at);
            const dateStr = date.toLocaleDateString('ja-JP');
            const timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

            // ステータス表示（既存のまま）
            const statusClass =
                request.status === 'approved' ? 'text-green-400' :
                request.status === 'rejected' ? 'text-red-400' : 'text-yellow-400';

            const statusText =
                request.status === 'approved' ? '承認済み' :
                request.status === 'rejected' ? '却下済み' : '承認待ち';

            // ★追加：表示ラベルをタイプ別に作る（prize対応）
            let typeLabel = '調整';

            if (request.type === 'withdraw') typeLabel = '引き出し';
            else if (request.type === 'deposit') typeLabel = '入金';
            else if (request.type === 'adjust') typeLabel = '調整';
            else if (request.type === 'prize') {
                const tname = tournamentMap.get(request.tournament_id) ?? 'トーナメント';
                const pos = request.position ? `${request.position}位` : '';
                typeLabel = `プライズ（${tname}${pos ? ' ' + pos : ''}）`;
            }

            const historyItem = document.createElement('div');
            historyItem.className = 'glass-card p-4 mb-3';

            historyItem.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <span class="text-white font-semibold">${typeLabel}</span>
                        <span class="${statusClass} text-sm ml-2">${statusText}</span>
                    </div>
                    <span class="text-yellow-300 font-bold">${Number(request.amount || 0).toLocaleString()} チップ</span>
                </div>
                <div class="text-gray-300 text-sm">
                    <i class="fas fa-calendar mr-1"></i>${dateStr} ${timeStr}
                </div>
            `;

            historyContainer.appendChild(historyItem);
        }
    } catch (error) {
        console.error('取引履歴読み込みエラー:', error);
        document.getElementById('transactionHistoryList').innerHTML =
            '<p class="text-red-400 text-center">履歴の読み込みに失敗しました</p>';
    }
}

function showChipManagement() {
    hideAllScreens();
    document.getElementById('chipManagementScreen').classList.remove('hidden');
    document.getElementById('chipBalanceManagement').textContent = currentUserData.balance.toLocaleString();
    showCustomerBottomNav();
}

function hideChipManagement() {
    showCustomerDashboard();
}

function showTournamentRanking() {
    hideAllScreens();
    document.getElementById('tournamentRankingScreen').classList.remove('hidden');
    showCustomerBottomNav();
    loadTournamentRanking();
}

function hideTournamentRanking() {
    showCustomerDashboard();
}

function showTournamentSchedule() {
    hideAllScreens();
    document.getElementById('tournamentScheduleScreen').classList.remove('hidden');
    showCustomerBottomNav();
    loadTournamentSchedule();
}

function hideTournamentSchedule() {
    showCustomerDashboard();
}



// トーナメント管理（管理者）
function showTournamentManagement() {
    hideAllScreens();
    document.getElementById('tournamentManagementScreen').classList.remove('hidden');
    loadTournamentList();
}

function hideTournamentManagement() {
    showAdminDashboard();
}

function showTournamentPrizeManagement() {
    hideAllScreens();
    document.getElementById('tournamentPrizeScreen').classList.remove('hidden');
    loadTournamentSelect();
}

function hideTournamentPrizeManagement() {
    showAdminDashboard();
}

// トーナメント追加
async function addTournament() {
    const name = document.getElementById('tournamentName').value.trim();
    const datetime = document.getElementById('tournamentDateTime').value;
    const registrationStart = document.getElementById('registrationStart').value;
    const registrationEnd = document.getElementById('registrationEnd').value;
    const entryFee = parseInt(document.getElementById('entryFee').value) || 0;
    const description = document.getElementById('tournamentDescription').value.trim();

    if (!name || !datetime) {
        alert('トーナメント名と開催日時は必須です。');
        return;
    }

    try {
        const tournamentData = {
            name: name,
            datetime: new Date(datetime).getTime(),
            registration_start: new Date(registrationStart).getTime(),
            registration_end: new Date(registrationEnd).getTime(),
            entry_fee: entryFee,
            description: description,
            status: 'upcoming',
            created_by: currentUser.id,
            created_at: Date.now(),
            updated_at: Date.now()
        };

        await createRecord('tournaments', tournamentData);
        
        alert('トーナメントを追加しました。');
        
        // フォームをクリア
        document.getElementById('tournamentName').value = '';
        document.getElementById('tournamentDateTime').value = '';
        document.getElementById('registrationStart').value = '';
        document.getElementById('registrationEnd').value = '';
        document.getElementById('entryFee').value = '';
        document.getElementById('tournamentDescription').value = '';
        
        loadTournamentList();
    } catch (error) {
        console.error('トーナメント追加エラー:', error);
        alert('トーナメントの追加に失敗しました。');
    }
}

// トーナメント一覧読み込み（管理者用）
async function loadTournamentList() {
    try {
        const tournaments = await fetchData('tournaments');
        const tournamentList = document.getElementById('tournamentList');
        tournamentList.innerHTML = '';

        if (!tournaments || tournaments.length === 0) {
            tournamentList.innerHTML = '<p class="text-gray-400 text-center">トーナメントがありません</p>';
            return;
        }

        const now = Date.now();
        tournaments.sort((a, b) => (a.datetime || 0) - (b.datetime || 0));

        for (const tournament of tournaments) {
            const isExpired = (tournament.datetime || 0) < now;

            const tournamentCard = document.createElement('div');
            tournamentCard.className = `glass-card p-4 mb-3 ${isExpired ? 'opacity-60' : ''}`;

            const date = new Date(tournament.datetime);
            const dateStr = date.toLocaleDateString('ja-JP');
            const timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

            tournamentCard.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <h4 class="text-white font-semibold">${tournament.name}</h4>
                    <span class="text-xs ${isExpired ? 'text-gray-400' : 'text-green-400'}">${isExpired ? '終了' : '開催予定'}</span>
                </div>
                <p class="text-gray-300 text-sm mb-1">
                    <i class="fas fa-calendar mr-1"></i>開催日時: ${dateStr} ${timeStr}
                </p>
                <p class="text-gray-300 text-sm mb-1">
                    <i class="fas fa-yen-sign mr-1"></i>エントリー料: ${(tournament.entry_fee || 0).toLocaleString()}円
                </p>
                ${tournament.description ? `<p class="text-gray-400 text-xs mb-2">${tournament.description}</p>` : ''}
                <div class="flex space-x-2 mt-3">
                    <button onclick="deleteTournament('${tournament.id}')" class="bg-red-600 text-white px-3 py-1 rounded text-sm">
                        <i class="fas fa-trash mr-1"></i>削除
                    </button>
                </div>
            `;
            tournamentList.appendChild(tournamentCard);
        }
    } catch (error) {
        console.error('トーナメント一覧読み込みエラー:', error);
    }
}

// トーナメント削除
async function deleteTournament(tournamentId) {
    if (!confirm('このトーナメントを削除してもよろしいですか？')) {
        return;
    }

    try {
        await deleteRecord('tournaments', tournamentId);
        alert('トーナメントを削除しました。');
        loadTournamentList();
    } catch (error) {
        console.error('トーナメント削除エラー:', error);
        alert('トーナメントの削除に失敗しました。');
    }
}

// トーナメント選択読み込み
async function loadTournamentSelect() {
    try {
        const tournaments = await fetchData('tournaments');
        const now = Date.now();
        const pastTournaments = tournaments.filter(t => t.datetime < now);
        
        const select = document.getElementById('selectTournamentForPrize');
        select.innerHTML = '<option value="">トーナメントを選択</option>';
        
        for (const tournament of pastTournaments) {
            const option = document.createElement('option');
            option.value = tournament.id;
            option.textContent = tournament.name;
            select.appendChild(option);
        }
    } catch (error) {
        console.error('トーナメント選択読み込みエラー:', error);
    }
}

// トーナメントプライズ用のトーナメント読み込み
async function loadTournamentForPrize() {
    const tournamentId = document.getElementById('selectTournamentForPrize').value;
    if (!tournamentId) {
        document.getElementById('prizeDistributionArea').classList.add('hidden');
        return;
    }

    document.getElementById('prizeDistributionArea').classList.remove('hidden');
    
    // ユーザー選択リストを更新
    const users = await fetchData('users');
    const userSelects = document.querySelectorAll('.prize-winner-select');
    
    userSelects.forEach(select => {
        select.innerHTML = '<option value="">ユーザーを選択</option>';
        for (const user of users) {
            if (user.role === 'customer') {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = `${user.name} (@${user.username})`;
                select.appendChild(option);
            }
        }
    });
}

// 入賞者を追加
function addPrizeWinner() {
    prizeWinnersCount++;
    const winnersList = document.getElementById('prizeWinnersList');
    
    const winnerDiv = document.createElement('div');
    winnerDiv.className = 'glass-card p-3';
    winnerDiv.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <span class="text-white font-semibold">${prizeWinnersCount}位</span>
            <button onclick="removePrizeWinner(this)" class="text-red-400 hover:text-red-300">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <select class="prize-winner-select w-full px-3 py-2 rounded-lg bg-white bg-opacity-20 text-white border border-white border-opacity-30 mb-2">
            <option value="">ユーザーを選択</option>
        </select>
        <input type="number" placeholder="チップ数" min="1" 
               class="prize-chips-input w-full px-3 py-2 rounded-lg bg-white bg-opacity-20 text-white placeholder-gray-300 border border-white border-opacity-30">
    `;
    
    winnersList.appendChild(winnerDiv);
    
    // ユーザー選択リストを更新
    loadTournamentForPrize();
}

// 入賞者を削除
function removePrizeWinner(button) {
    button.closest('.glass-card').remove();
}

// プライズ配分
// プライズ配分（安定版：batch_id付き＋履歴保存＋ランキング更新）
async function distributePrizes() {
    const tournamentId = document.getElementById('selectTournamentForPrize').value;
    if (!tournamentId) {
        alert('トーナメントを選択してください。');
        return;
    }

    const winners = [];
    const winnerDivs = document.querySelectorAll('#prizeWinnersList .glass-card');

    for (let i = 0; i < winnerDivs.length; i++) {
        const div = winnerDivs[i];
        const userId = div.querySelector('.prize-winner-select')?.value;
        const chips = parseInt(div.querySelector('.prize-chips-input')?.value, 10);

        if (!userId || !Number.isFinite(chips) || chips <= 0) {
            alert(`${i + 1}位のユーザーとチップ数を正しく入力してください。`);
            return;
        }

        winners.push({
            user_id: userId,
            position: i + 1,
            chips_won: chips
        });
    }

    if (winners.length === 0) {
        alert('入賞者を少なくとも1人追加してください。');
        return;
    }

    try {
        const batchId = _newId();     // 配布1回分のID
        const now = Date.now();       // 時刻は1回だけ

        for (const winner of winners) {
            // 1) tournament_results に保存（取り消し用に batch_id 必須）
            await createRecord('tournament_results', {
                tournament_id: tournamentId,
                user_id: winner.user_id,
                position: winner.position,
                chips_won: winner.chips_won,
                batch_id: batchId,
                created_at: now
            });

            // 2) チップ残高を増加
            const chipData = await fetchSingleRecord('chips', null, `user_id=${winner.user_id}`);
            if (chipData) {
                await updateRecord('chips', chipData.id, {
                    balance: (chipData.balance || 0) + winner.chips_won,
                    updated_at: now
                });
            } else {
                await createRecord('chips', {
                    user_id: winner.user_id,
                    balance: winner.chips_won,
                    created_at: now,
                    updated_at: now
                });
            }

            // 3) 履歴（requests）に「プライズ」を残す（ここにも batch_id 入れる）
            await createRecord('requests', {
                user_id: winner.user_id,
                type: 'prize',
                amount: winner.chips_won,     // +で入る
                status: 'approved',
                created_at: now,
                updated_at: now,
                tournament_id: tournamentId,
                position: winner.position,
                batch_id: batchId
            });
        }

        alert('プライズを配分しました。');

        // 表示中なら更新
        if (typeof refreshRankingIfVisible === 'function') refreshRankingIfVisible();
        if (typeof loadTournamentRanking === 'function') loadTournamentRanking();
        if (typeof loadTransactionHistory === 'function') loadTransactionHistory();

        // 入賞者欄をリセット（次回のため）
        document.getElementById('prizeWinnersList').innerHTML = '';
        prizeWinnersCount = 0;

        hideTournamentPrizeManagement();
    } catch (error) {
        console.error('プライズ配分エラー:', error);
        alert('プライズの配分に失敗しました。\n原因: ' + (error?.message || error));
    }
}

// レーキ管理
async function recordRake() {
    const amount = parseInt(document.getElementById('rakeAmount').value);
    const memo = document.getElementById('rakeMemo').value.trim();

    if (!amount || amount <= 0) {
        alert('正しいレーキ金額を入力してください。');
        return;
    }

    try {
        const rakeData = {
            collection_date: Date.now(),
            rake_amount: amount,
            memo: memo,
            recorded_by: currentUser.id,
            created_at: Date.now()
        };

        await createRecord('rake_history', rakeData);
        
        alert('レーキを記録しました。');
        
        // フォームをクリア
        document.getElementById('rakeAmount').value = '';
        document.getElementById('rakeMemo').value = '';
        
        // レーキ合計を更新
        await updateRakeTotal();
    } catch (error) {
        console.error('レーキ記録エラー:', error);
        alert('レーキの記録に失敗しました。');
    }
}

// レーキ合計を更新
async function updateRakeTotal() {
    try {
        const rakeHistory = await fetchData('rake_history');
        const totalRake = rakeHistory.reduce((sum, record) => sum + record.rake_amount, 0);
        document.getElementById('totalRakeAmount').textContent = totalRake.toLocaleString();
        document.getElementById('totalRakeRecords').textContent = rakeHistory.length;
    } catch (error) {
        console.error('レーキ合計更新エラー:', error);
    }
}

// トーナメントインマネランキング読み込み
async function loadTournamentRanking() {
    try {
        const tournamentResults = await fetchData('tournament_results');
        const users = await fetchData('users');
        
        // ユーザーのインマネ合計を集計
        const userEarnings = {};
        
        for (const result of tournamentResults) {
            if (!userEarnings[result.user_id]) {
                userEarnings[result.user_id] = 0;
            }
            userEarnings[result.user_id] += result.chips_won;
        }
        
        // ランキングデータを作成
        const rankingData = [];
        for (const [userId, totalEarnings] of Object.entries(userEarnings)) {
            const user = users.find(u => u.id === userId);
            if (user && user.role === 'customer') {
                rankingData.push({
                    user: user,
                    totalEarnings: totalEarnings
                });
            }
        }
        
        // 収益でソート（降順）
        rankingData.sort((a, b) => b.totalEarnings - a.totalEarnings);
        
        const rankingContainer = document.getElementById('tournamentRankingList');
        rankingContainer.innerHTML = '';
        
        if (rankingData.length === 0) {
            rankingContainer.innerHTML = '<p class="text-gray-400 text-center">インマネデータがありません</p>';
            return;
        }
        
        // ランキング表示
        for (let i = 0; i < rankingData.length; i++) {
            const rank = i + 1;
            const { user, totalEarnings } = rankingData[i];
            
            const rankingItem = document.createElement('div');
            rankingItem.className = 'ranking-item flex items-center justify-between p-4 rounded-lg mb-3';
            

            // 上位3位はチップランキングと同じクラスを使う（CSSが既にある）
if (rank === 1) rankingItem.classList.add('rank-1');
if (rank === 2) rankingItem.classList.add('rank-2');
if (rank === 3) rankingItem.classList.add('rank-3');

            
            
            rankingItem.innerHTML = `
  <div class="flex items-center">
    <div class="rank-number">${rank}</div>
    <div class="ml-4">
      <div class="name-text font-semibold">${user.name}</div>
      <div class="handle-text text-sm">@${user.username}</div>
    </div>
  </div>
  <div class="text-right">
    <div class="amount-text font-bold text-lg">${totalEarnings.toLocaleString()} チップ</div>
    ${rank === 1 ? '<div class="label-text text-sm">👑 1位</div>' : ''}
    ${rank === 2 ? '<div class="label-text text-sm">🥈 2位</div>' : ''}
    ${rank === 3 ? '<div class="label-text text-sm">🥉 3位</div>' : ''}
  </div>
`;

            rankingContainer.appendChild(rankingItem);
        }
        
    } catch (error) {
        console.error('トーナメントインマネランキング読み込みエラー:', error);
        document.getElementById('tournamentRankingList').innerHTML = '<p class="text-red-400 text-center">ランキングの読み込みに失敗しました</p>';
    }
}
// ランキング画面が表示中なら更新する（おすすめ）
function refreshRankingIfVisible() {
    const screen = document.getElementById('rankingScreen');
    if (!screen) return;

    const isVisible = !screen.classList.contains('hidden');
    if (isVisible && typeof loadRanking === 'function') {
        loadRanking();
    }
}
// レーキ履歴表示
async function showRakeHistory() {
    try {
        const rakeHistory = await fetchData('rake_history');
        
        if (rakeHistory.length === 0) {
            alert('レーキ履歴がありません。');
            return;
        }

        // 日付順にソート
        rakeHistory.sort((a, b) => b.collection_date - a.collection_date);

        let historyText = '【レーキ履歴】\n\n';
        let totalRake = 0;

        for (const record of rakeHistory) {
            const date = new Date(record.collection_date);
            const dateStr = date.toLocaleDateString('ja-JP');
            const timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            
            historyText += `日時: ${dateStr} ${timeStr}\n`;
            historyText += `金額: ${record.rake_amount.toLocaleString()}円\n`;
            if (record.memo) {
                historyText += `メモ: ${record.memo}\n`;
            }
            historyText += '---\n';
            
            totalRake += record.rake_amount;
        }

        historyText += `\n【合計】 ${totalRake.toLocaleString()}円`;
        
        alert(historyText);
    } catch (error) {
        console.error('レーキ履歴読み込みエラー:', error);
        alert('レーキ履歴の読み込みに失敗しました。');
    }
}

// トーナメントランキング読み込み
// トーナメント予定表読み込み
async function loadTournamentSchedule() {
    try {
        const tournaments = await fetchData('tournaments');
        const now = Date.now();
        
        // 未来のトーナメントをフィルタリングしてソート
        const upcomingTournaments = tournaments
            .filter(t => t.datetime >= now)
            .sort((a, b) => a.datetime - b.datetime);

        const scheduleContainer = document.getElementById('tournamentScheduleList');
        scheduleContainer.innerHTML = '';

        if (upcomingTournaments.length === 0) {
            scheduleContainer.innerHTML = '<p class="text-gray-400 text-center">今後のトーナメント予定はありません</p>';
            return;
        }

        for (const tournament of upcomingTournaments) {
            const tournamentCard = document.createElement('div');
            tournamentCard.className = 'tournament-card';
            
            const date = new Date(tournament.datetime);
            const dateStr = date.toLocaleDateString('ja-JP');
            const timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            
            let registrationInfo = '';
            if (tournament.registration_start && tournament.registration_end) {
                const regStart = new Date(tournament.registration_start);
                const regEnd = new Date(tournament.registration_end);
                registrationInfo = `
                    <p class="text-gray-300 text-xs mb-1">
                        <i class="fas fa-clock mr-1"></i>受付: ${regStart.toLocaleDateString('ja-JP')} ${regStart.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} - ${regEnd.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                `;
            }
            
            tournamentCard.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <h4 class="text-white font-semibold">${tournament.name}</h4>
                    <span class="status-badge upcoming">開催予定</span>
                </div>
                <p class="text-gray-300 text-sm mb-1">
                    <i class="fas fa-calendar mr-1"></i>開催日時: ${dateStr} ${timeStr}
                </p>
                ${registrationInfo}
                <p class="text-gray-300 text-sm mb-1">
                    <i class="fas fa-yen-sign mr-1"></i>エントリー料: ${tournament.entry_fee.toLocaleString()}円
                </p>
                ${tournament.description ? `<p class="text-gray-400 text-xs mb-2">${tournament.description}</p>` : ''}
            `;
            scheduleContainer.appendChild(tournamentCard);
        }
    } catch (error) {
        console.error('トーナメント予定表読み込みエラー:', error);
    }
}

// 既存の関数も更新
function showWithdrawForm() {
    hideAllScreens();
    document.getElementById('withdrawForm').classList.remove('hidden');
    showCustomerBottomNav();
}

function showDepositForm() {
    hideAllScreens();
    document.getElementById('depositForm').classList.remove('hidden');
    showCustomerBottomNav();
}

function hideForms() {
    document.getElementById('withdrawForm').classList.add('hidden');
    document.getElementById('depositForm').classList.add('hidden');
    showChipManagement();
}

function showRanking() {
    hideAllScreens();
    document.getElementById('rankingScreen').classList.remove('hidden');
    showCustomerBottomNav();
    loadRanking();
}

// チップ残高ランキング（残高の多い順）
async function loadRanking() {
    try {
        const users = await fetchData('users');
        const chips = await fetchData('chips');

        // user_id -> balance の辞書
        const balanceMap = new Map(chips.map(c => [c.user_id, Number(c.balance || 0)]));

        // customer だけ対象にして、balance を持たせる
        const rankingData = users
            .filter(u => u.role === 'customer')
            .map(u => ({
                user: u,
                balance: balanceMap.get(u.id) ?? 0
            }))
            .sort((a, b) => b.balance - a.balance);

        const container = document.getElementById('rankingList');
        container.innerHTML = '';

        if (rankingData.length === 0) {
            container.innerHTML = '<p class="text-gray-400 text-center">ランキングデータがありません</p>';
            return;
        }

        for (let i = 0; i < rankingData.length; i++) {
            const rank = i + 1;
            const { user, balance } = rankingData[i];

            const item = document.createElement('div');
            item.className = 'ranking-item flex items-center justify-between';

            // 上位3位は既存CSS（rank-1/2/3）を使う
            if (rank === 1) item.classList.add('rank-1');
            if (rank === 2) item.classList.add('rank-2');
            if (rank === 3) item.classList.add('rank-3');

           item.innerHTML = `
  <div class="flex items-center gap-3">
    <div class="rank-number">${rank}</div>
    <div>
      <div class="name-text font-semibold">${user.name}</div>
      <div class="handle-text text-sm">@${user.username}</div>
    </div>
  </div>
  <div class="text-right">
    <div class="amount-text font-bold text-lg">${balance.toLocaleString()} チップ</div>
  </div>
`;


            container.appendChild(item);
        }
    } catch (error) {
        console.error('チップランキング読み込みエラー:', error);
        document.getElementById('rankingList').innerHTML =
            '<p class="text-red-400 text-center">ランキングの読み込みに失敗しました</p>';
    }
}

function hideRanking() {
    showCustomerDashboard();
}

// その他の既存関数も更新
(function(){ const el=document.getElementById('withdrawAmount'); if(!el) return; el.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        submitWithdraw();
    }
});

const el2=document.getElementById('depositAmount'); if(!el2) return; el2.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        submitDeposit();
    }
});

})();

/* =========================
   未実装だった主要操作の補完
   ========================= */

// 入金申請（顧客）
async function submitDeposit() {
    const amount = parseInt(document.getElementById('depositAmount').value, 10);

    if (!Number.isFinite(amount) || amount <= 0) {
        alert('入金枚数を正しく入力してください。');
        return;
    }

    try {
        await createRecord('requests', {
            user_id: currentUser.id,
            type: 'deposit',
            amount: amount,
            status: 'pending',
            created_at: Date.now(),
            updated_at: Date.now()
        });

        document.getElementById('depositAmount').value = '';
        alert('入金申請を送信しました。管理者の承認をお待ちください。');
        showChipManagement();
    } catch (error) {
        console.error('入金申請エラー:', error);
        alert('入金申請に失敗しました。');
    }
}

// 引き出し（顧客・即時反映）
async function submitWithdraw() {
    const amount = parseInt(document.getElementById('withdrawAmount').value, 10);

    if (!Number.isFinite(amount) || amount <= 0) {
        alert('引き出し枚数を正しく入力してください。');
        return;
    }

    if (!currentUserData || amount > currentUserData.balance) {
        alert('残高が不足しています。');
        return;
    }

    try {
        // 残高を即時反映
        const newBalance = currentUserData.balance - amount;
        const updated = await updateRecord('chips', currentUserData.id, {
            balance: newBalance,
            updated_at: Date.now()
        });
        currentUserData = updated;

        // 履歴として記録（withdraw は即時処理なので approved にしておく）
        await createRecord('requests', {
            user_id: currentUser.id,
            type: 'withdraw',
            amount: amount,
            status: 'approved',
            created_at: Date.now(),
            updated_at: Date.now()
        });

        // 確認画面表示（管理者に見せる想定）
        pendingWithdraw = { amount, user: currentUser, created_at: Date.now() };

        // 画面の表示テキストをセット
        const confirmScreen = document.getElementById('withdrawConfirm');
        confirmScreen.querySelector('.user-name').textContent = `${currentUser.name}`;
        confirmScreen.querySelector('.amount').textContent = `${amount.toLocaleString()} チップ`;

        document.getElementById('withdrawAmount').value = '';

        hideAllScreens();
        confirmScreen.classList.remove('hidden');
    } catch (error) {
        console.error('引き出しエラー:', error);
        alert('引き出しに失敗しました。');
    }
}

// 引き出し確認完了（顧客）
function confirmWithdraw() {
    pendingWithdraw = null;
    alert('確認完了。ありがとうございました。');
    showCustomerDashboard();
}

// 入金申請 承認（管理者）
async function approveRequest(requestId) {
    try {
        const requests = await fetchData('requests');
        const req = requests.find(r => r.id === requestId);
        if (!req) {
            alert('申請が見つかりません。');
            return;
        }
        if (req.status !== 'pending') {
            alert('この申請は既に処理済みです。');
            return;
        }

        // 入金なら残高に加算
        if (req.type === 'deposit') {
            const chip = await fetchSingleRecord('chips', null, `user_id=${req.user_id}`);
            if (chip) {
                await updateRecord('chips', chip.id, {
                    balance: (chip.balance || 0) + req.amount,
                    updated_at: Date.now()
                });
            } else {
                await createRecord('chips', {
                    user_id: req.user_id,
                    balance: req.amount,
                    created_at: Date.now(),
                    updated_at: Date.now()
                });
            }
        }

        await updateRecord('requests', requestId, { status: 'approved', updated_at: Date.now() });

        await loadAdminData();
        alert('承認しました。');
    } catch (error) {
        console.error('承認エラー:', error);
        alert('承認に失敗しました。');
    }
}

// 入金申請 却下（管理者）
async function rejectRequest(requestId) {
    try {
        const requests = await fetchData('requests');
        const req = requests.find(r => r.id === requestId);
        if (!req) {
            alert('申請が見つかりません。');
            return;
        }
        if (req.status !== 'pending') {
            alert('この申請は既に処理済みです。');
            return;
        }

        await updateRecord('requests', requestId, { status: 'rejected', updated_at: Date.now() });

        await loadAdminData();
        alert('却下しました。');
    } catch (error) {
        console.error('却下エラー:', error);
        alert('却下に失敗しました。');
    }
}

// チップ調整（管理者）
async function adjustChips(action) {
    const userId = document.getElementById('selectUserForChip').value;
    const amount = parseInt(document.getElementById('chipAmount').value, 10);

    if (!userId) {
        alert('ユーザーを選択してください。');
        return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        alert('枚数を正しく入力してください。');
        return;
    }

    try {
        let chip = await fetchSingleRecord('chips', null, `user_id=${userId}`);
        if (!chip) {
            chip = await createRecord('chips', {
                user_id: userId,
                balance: 0,
                created_at: Date.now(),
                updated_at: Date.now()
            });
        }

        let newBalance = chip.balance || 0;
        if (action === 'add') newBalance += amount;
        if (action === 'subtract') newBalance -= amount;

        if (newBalance < 0) {
            alert('減少後の残高がマイナスになります。');
            return;
        }

        await updateRecord('chips', chip.id, { balance: newBalance, updated_at: Date.now() });

        // 履歴に「調整」を残す（顧客履歴表示も対応）
        await createRecord('requests', {
            user_id: userId,
            type: 'adjust',
            amount: action === 'subtract' ? -amount : amount,
            status: 'approved',
            created_at: Date.now(),
            updated_at: Date.now()
        });

        document.getElementById('chipAmount').value = '';
        await loadAdminData();
        alert('更新しました。');
    } catch (error) {
        console.error('チップ調整エラー:', error);
        alert('更新に失敗しました。');
    }
}

// 初期化時に管理者アカウントを作成
async function initializeAdminAccount() {
    try {
        const users = await fetchData('users');
        const adminExists = users.find(u => u.username === 'RR管理者');
        
        if (!adminExists) {
            const adminUser = {
                username: 'RR管理者',
                password: 'rr1106',
                name: 'RR管理者',
                role: 'admin',
                created_at: Date.now()
            };
            
            await createRecord('users', adminUser);
            console.log('管理者アカウントを作成しました');
        }
    } catch (error) {
        console.error('管理者アカウント初期化エラー:', error);
    }
}

// 直近のプライズ配布（選択中トーナメント）を取り消す
async function revokeLatestPrizeBatch() {
    const tournamentId = document.getElementById('selectTournamentForPrize').value;
    if (!tournamentId) {
        alert('トーナメントを選択してください。');
        return;
    }
    if (!confirm('直近のプライズ配布を取り消します。よろしいですか？')) return;

    try {
        // そのトーナメントの結果を取得
        const results = await fetchData('tournament_results');
        const target = results.filter(r => r.tournament_id === tournamentId);

        if (target.length === 0) {
            alert('このトーナメントには配布済みプライズがありません。');
            return;
        }

        // batch_id がある前提で「直近」を取る（batch_id無しデータが混ざる場合にも最低限対応）
        const latestCreated = Math.max(...target.map(r => r.created_at || 0));
        const latestBatch = target
            .filter(r => (r.created_at || 0) === latestCreated)
            .map(r => r.batch_id)
            .find(Boolean);

        let batchResults;
        if (latestBatch) {
            batchResults = target.filter(r => r.batch_id === latestBatch);
        } else {
            // 古いデータ（batch_id無し）の場合は created_at が最新のものだけ取り消す
            batchResults = target.filter(r => (r.created_at || 0) === latestCreated);
        }

        // まず「引けるか」チェック（マイナスになるなら止める）
        for (const r of batchResults) {
            const chip = await fetchSingleRecord('chips', null, `user_id=${r.user_id}`);
            const bal = chip ? (chip.balance || 0) : 0;
            if (bal - (r.chips_won || 0) < 0) {
                alert(`取り消しできません。\n受取者の残高が不足しています。\nユーザーID: ${r.user_id}`);
                return;
            }
        }

        // 取り消し実行：残高を戻す → 履歴を消す → 結果を消す
        const now = Date.now();

        for (const r of batchResults) {
            const chip = await fetchSingleRecord('chips', null, `user_id=${r.user_id}`);
            await updateRecord('chips', chip.id, {
                balance: (chip.balance || 0) - (r.chips_won || 0),
                updated_at: now
            });
        }

        // requests（履歴）も消す（batch_id があればそれで、無ければ tournament_id+created_at で）
        const reqs = await fetchData('requests');
        const toDeleteReq = reqs.filter(x =>
            x.type === 'prize' &&
            x.tournament_id === tournamentId &&
            (latestBatch ? x.batch_id === latestBatch : (x.created_at || 0) === latestCreated)
        );
        for (const x of toDeleteReq) {
            await deleteRecord('requests', x.id);
        }

        // tournament_results を削除
        for (const r of batchResults) {
            await deleteRecord('tournament_results', r.id);
        }

        alert('直近のプライズ配布を取り消しました。');

        // ランキングが開いていたら更新（あなたのrefresh関数を使う）
        if (typeof refreshRankingIfVisible === 'function') refreshRankingIfVisible();

    } catch (e) {
        console.error('プライズ取り消しエラー:', e);
        alert('取り消しに失敗しました。');
    }
}

function showCustomerBottomNav() {
    const nav = document.getElementById('customerBottomNav');
    if (nav) nav.classList.remove('hidden');
}

function hideCustomerBottomNav() {
    const nav = document.getElementById('customerBottomNav');
    if (nav) nav.classList.add('hidden');
}




// その後の実装に続きます...
