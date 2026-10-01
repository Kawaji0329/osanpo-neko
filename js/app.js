(() => {
  // ===== 第3.1版：GPS安定化 + おさんぽ時間と歩行ボーナス =====
  // 通常版：30分 / 100mごとに1分短縮 / 最短10分
  // URL末尾に ?test=1 を付けると、短時間で動作確認できます。
  const TEST_MODE = new URLSearchParams(location.search).get('test') === '1';
  const BASE_WALK_MS = TEST_MODE ? 60 * 1000 : 30 * 60 * 1000;
  const MIN_WALK_MS = TEST_MODE ? 20 * 1000 : 10 * 60 * 1000;
  const METERS_PER_BONUS = TEST_MODE ? 10 : 100;
  const BONUS_MS_PER_STEP = TEST_MODE ? 5 * 1000 : 60 * 1000;
  const MAX_BONUS_MS = BASE_WALK_MS - MIN_WALK_MS;

  // GPSの揺れを歩行距離に数えすぎないための簡易フィルタ
  const MAX_ACCEPTED_ACCURACY_M = 100; // 精度が悪すぎる測位は距離に使わない
  const MIN_SEGMENT_M = 4;             // GPSの細かな揺れは無視
  const MAX_WALK_SPEED_MPS = 5;        // 約18km/h以上は歩行として無視
  const MAX_POINT_GAP_MS = 90 * 1000;  // 長時間途切れた後は現在地を新しい基準点にする
  const GPS_RETRY_DELAY_MS = 5000;
  const GPS_SILENT_TIMEOUT_MS = 30000; // watchPositionが沈黙した場合の再起動目安

  const screens = [...document.querySelectorAll('.screen')];
  const $ = (id) => document.getElementById(id);
  let timerId = null;
  let currentTrip = null;
  let geoWatchId = null;
  let lastGeoPoint = null;
  let geoRetryTimer = null;
  let geoWatchdogTimer = null;
  let geoConsecutiveErrors = 0;
  let geoUsingFallback = false;
  let geoTrackingWanted = false;

  const trips = [
    { id:'tokyo_asakusa', area:'東京', place:'浅草・雷門', message:'雷門の近くまで行ってきたよ！', image:'assets/travel/tokyo_asakusa.jpg' },
    { id:'tokyo_tokyotower', area:'東京', place:'東京タワー', message:'東京タワーを見てきたよ！', image:'assets/travel/tokyo_tokyotower.jpg' },
    { id:'tokyo_ueno', area:'東京', place:'上野公園', message:'上野公園をのんびり歩いてきたよ！', image:'assets/travel/tokyo_ueno.jpg' },
    { id:'tokyo_station', area:'東京', place:'東京駅', message:'赤レンガの東京駅を見てきたよ！', image:'assets/travel/tokyo_station.jpg' },

    { id:'kyoto_fushimi', area:'京都', place:'伏見稲荷', message:'赤い鳥居の道を歩いてきたよ！', image:'assets/travel/kyoto_fushimi.jpg' },
    { id:'kyoto_kiyomizu', area:'京都', place:'清水寺', message:'清水寺から京都の景色を見てきたよ！', image:'assets/travel/kyoto_kiyomizu.jpg' },
    { id:'kyoto_arashiyama', area:'京都', place:'嵐山', message:'竹林の中をおさんぽしてきたよ！', image:'assets/travel/kyoto_arashiyama.jpg' },
    { id:'kyoto_yasaka', area:'京都', place:'八坂の塔周辺', message:'京都の古い町並みを歩いてきたよ！', image:'assets/travel/kyoto_yasaka.jpg' },

    { id:'hokkaido_otaru', area:'北海道', place:'小樽運河', message:'小樽運河のそばを歩いてきたよ！', image:'assets/travel/hokkaido_otaru.jpg' },
    { id:'hokkaido_clocktower', area:'北海道', place:'札幌時計台', message:'札幌時計台を見てきたよ！', image:'assets/travel/hokkaido_clocktower.jpg' },
    { id:'hokkaido_biei', area:'北海道', place:'美瑛', message:'広い丘をいっぱい歩いてきたよ！', image:'assets/travel/hokkaido_biei.jpg' },
    { id:'hokkaido_furano', area:'北海道', place:'富良野', message:'きれいな花畑を見つけたよ！', image:'assets/travel/hokkaido_furano.jpg' }
  ];

  const areaOrder = ['東京','京都','北海道'];

  function show(id){
    screens.forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo(0,0);
  }

  function catName(){ return localStorage.getItem('osanpoCatName') || 'ねこ'; }
  function paintName(){ document.querySelectorAll('.cat-name').forEach(el => el.textContent = catName()); }

  function openNameIfNeeded(){
    if(!localStorage.getItem('osanpoCatName')) $('nameModal').classList.add('show');
  }

  function saveName(){
    const name = $('nameInput').value.trim() || 'ねこ';
    localStorage.setItem('osanpoCatName', name);
    $('nameModal').classList.remove('show');
    paintName();
  }

  function ownedMap(){
    try{ return JSON.parse(localStorage.getItem('osanpoOwnedSpots') || '{}'); }
    catch(e){ return {}; }
  }

  function ownedCount(){ return Object.keys(ownedMap()).length; }

  function updateHomeCount(){
    $('homeAlbumCount').textContent = `${ownedCount()} / ${trips.length}`;
  }

  function formatDate(iso){
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP');
  }

  function openPhotoModal(spot, obtainedAt){
    $('modalTripPhoto').src = spot.image;
    $('modalTripPhoto').alt = `${spot.area}・${spot.place}の旅写真`;
    $('modalTripArea').textContent = spot.area;
    $('modalTripName').textContent = spot.place;
    $('modalTripLine').textContent = spot.message;
    $('modalTripDate').textContent = obtainedAt ? `${formatDate(obtainedAt)} に発見` : '';
    $('photoModal').classList.add('show');
    $('photoModal').setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }

  function closePhotoModal(){
    $('photoModal').classList.remove('show');
    $('photoModal').setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  function chooseTrip(){
    currentTrip = trips[Math.floor(Math.random()*trips.length)];
    localStorage.setItem('osanpoCurrentTripId', currentTrip.id);
  }

  function loadCurrentTrip(){
    if(currentTrip) return currentTrip;
    const id = localStorage.getItem('osanpoCurrentTripId');
    currentTrip = trips.find(t => t.id === id) || null;
    return currentTrip;
  }

  function renderTrip(){
    if(!loadCurrentTrip()) chooseTrip();
    const owned = ownedMap();
    const isNew = !owned[currentTrip.id];

    $('tripArea').textContent = currentTrip.area;
    $('tripName').textContent = currentTrip.place;
    $('tripLine').textContent = currentTrip.message;
    $('tripPhoto').src = currentTrip.image;
    $('tripPhoto').alt = `${currentTrip.area}・${currentTrip.place}の旅写真`;
    $('photoBadge').hidden = !isNew;

    if(isNew){
      $('photoStatus').textContent = 'はじめての場所！';
      $('saveBtn').textContent = 'アルバムに保存';
      $('saveBtn').disabled = false;
    } else {
      $('photoStatus').textContent = 'ここ、前にも来たことがあるみたい。';
      $('saveBtn').textContent = 'アルバムに登録済み ✓';
      $('saveBtn').disabled = true;
    }
  }

  function format(ms){
    const total = Math.max(0, Math.ceil(ms/1000));
    const m = String(Math.floor(total/60)).padStart(2,'0');
    const s = String(total%60).padStart(2,'0');
    return `${m}:${s}`;
  }

  function formatDistance(meters){
    if(meters >= 1000) return `${(meters/1000).toFixed(meters >= 10000 ? 1 : 2)} km`;
    return `${Math.floor(meters)} m`;
  }

  function walkDistance(){
    return Math.max(0, Number(localStorage.getItem('osanpoWalkDistanceM') || 0));
  }

  function bonusMsForDistance(distanceM){
    const steps = Math.floor(distanceM / METERS_PER_BONUS);
    return Math.min(steps * BONUS_MS_PER_STEP, MAX_BONUS_MS);
  }

  function effectiveEndAt(){
    const start = Number(localStorage.getItem('osanpoWalkStartAt') || 0);
    const baseEnd = Number(localStorage.getItem('osanpoBaseEndAt') || 0);
    if(!start || !baseEnd) return Number(localStorage.getItem('osanpoEndAt') || 0);
    const shortened = baseEnd - bonusMsForDistance(walkDistance());
    return Math.max(start + MIN_WALK_MS, shortened);
  }

  function syncWalkUI(){
    const distanceM = walkDistance();
    const bonusMs = bonusMsForDistance(distanceM);
    $('distance').textContent = formatDistance(distanceM);
    $('bonusTime').textContent = bonusMs > 0 ? `${Math.floor(bonusMs/60000)}分` : '0分';
    if(TEST_MODE && bonusMs > 0){
      $('bonusTime').textContent = `${Math.floor(bonusMs/1000)}秒`;
    }
  }

  function setGpsStatus(message, tone='normal', showRetry=false){
    const el = $('gpsStatus');
    el.textContent = message;
    el.dataset.tone = tone;
    if($('gpsRetryBtn')) $('gpsRetryBtn').hidden = !showRetry;
  }

  function haversineMeters(lat1, lon1, lat2, lon2){
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2-lat1);
    const dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function clearGeoTimers(){
    if(geoRetryTimer !== null) clearTimeout(geoRetryTimer);
    if(geoWatchdogTimer !== null) clearTimeout(geoWatchdogTimer);
    geoRetryTimer = null;
    geoWatchdogTimer = null;
  }

  function armGeoWatchdog(){
    if(geoWatchdogTimer !== null) clearTimeout(geoWatchdogTimer);
    geoWatchdogTimer = setTimeout(() => {
      if(!geoTrackingWanted || localStorage.getItem('osanpoState') !== 'walk' || document.visibilityState !== 'visible') return;
      setGpsStatus('位置情報の応答が止まったため、自動で再接続しています…', 'waiting', true);
      restartGeoWatch(true);
    }, GPS_SILENT_TIMEOUT_MS);
  }

  function scheduleGeoRetry(useFallback){
    if(!geoTrackingWanted || localStorage.getItem('osanpoState') !== 'walk') return;
    if(geoRetryTimer !== null) clearTimeout(geoRetryTimer);
    geoRetryTimer = setTimeout(() => {
      geoRetryTimer = null;
      if(document.visibilityState === 'visible') restartGeoWatch(useFallback);
    }, GPS_RETRY_DELAY_MS);
  }

  function onGeoSuccess(position){
    if(localStorage.getItem('osanpoState') !== 'walk' || !geoTrackingWanted) return;
    armGeoWatchdog();
    geoConsecutiveErrors = 0;

    const { latitude, longitude, accuracy } = position.coords;
    const timestamp = position.timestamp || Date.now();

    if(!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if(Number.isFinite(accuracy) && accuracy > MAX_ACCEPTED_ACCURACY_M){
      setGpsStatus(`現在地は受信できています。精度が上がるのを待っています…（約${Math.round(accuracy)}m）`, 'waiting', true);
      return;
    }

    const point = { latitude, longitude, accuracy:Number.isFinite(accuracy) ? accuracy : 0, timestamp };
    if(!lastGeoPoint){
      lastGeoPoint = point;
      setGpsStatus(geoUsingFallback ? '位置情報を再取得しました。計測を続けます。' : '位置情報を取得しました。いっしょに歩いてみよう！', 'ok');
      return;
    }

    // ページ復帰やGPS停止などで長時間空いた場合、その間を直線距離として数えない。
    const gapMs = timestamp - lastGeoPoint.timestamp;
    if(gapMs <= 0 || gapMs > MAX_POINT_GAP_MS){
      lastGeoPoint = point;
      setGpsStatus('現在地を基準にして、ここから距離計測を再開します。', 'ok');
      return;
    }

    const segment = haversineMeters(lastGeoPoint.latitude, lastGeoPoint.longitude, latitude, longitude);
    const seconds = Math.max(1, gapMs / 1000);
    const speed = segment / seconds;

    // 測位精度が粗いほど、小さな揺れを距離に数えないよう閾値を少し上げる。
    const combinedAccuracy = Math.max(lastGeoPoint.accuracy || 0, point.accuracy || 0);
    const dynamicMinSegment = Math.max(MIN_SEGMENT_M, Math.min(15, combinedAccuracy * 0.15));

    if(segment < dynamicMinSegment){
      // 小さな移動では基準点を更新しない。実際の歩行が積み重なると閾値を超えて計測される。
      return;
    }

    if(speed > MAX_WALK_SPEED_MPS){
      // GPSジャンプは距離に入れないが、その地点を新しい基準にして異常値の連鎖を防ぐ。
      lastGeoPoint = point;
      setGpsStatus('大きな位置ずれを検出したため、この移動は数えませんでした。計測は続けています。', 'waiting', true);
      return;
    }

    lastGeoPoint = point;
    const before = walkDistance();
    const beforeBonus = bonusMsForDistance(before);
    const after = before + segment;
    localStorage.setItem('osanpoWalkDistanceM', String(after));
    const afterBonus = bonusMsForDistance(after);
    syncWalkUI();

    if(afterBonus > beforeBonus){
      const unit = TEST_MODE ? `${Math.floor(afterBonus/1000)}秒` : `${Math.floor(afterBonus/60000)}分`;
      setGpsStatus(`${catName()}、うれしくて足どりが軽いみたい！ 帰宅が${unit}早くなりました。`, 'bonus');
    } else {
      setGpsStatus('位置情報取得中。いっしょに歩いています。', 'ok');
    }
  }

  function onGeoError(error){
    if(!geoTrackingWanted || localStorage.getItem('osanpoState') !== 'walk') return;
    if(geoWatchdogTimer !== null) clearTimeout(geoWatchdogTimer);
    geoWatchdogTimer = null;

    if(error.code === 1){
      // 拒否だけは自動再試行しない。設定変更後にボタンから再開できる。
      geoTrackingWanted = false;
      if(geoWatchId !== null && 'geolocation' in navigator) navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
      setGpsStatus('位置情報が許可されていません。タイマーはそのまま進みます。許可後に「位置情報を再取得」を押してください。', 'error', true);
      return;
    }

    geoConsecutiveErrors += 1;
    const isTimeout = error.code === 3;
    const message = isTimeout
      ? '位置情報の取得に時間がかかっています。前回の位置を保ったまま再試行します…'
      : '現在地を一時的に取得できません。前回の位置を保ったまま再接続しています…';
    setGpsStatus(message, 'waiting', true);

    // 高精度取得が続けて失敗したら、標準精度へ切り替えて接続を維持する。
    const useFallback = geoUsingFallback || geoConsecutiveErrors >= 2;
    scheduleGeoRetry(useFallback);
  }

  function restartGeoWatch(useFallback=false, resetBase=false){
    if(!geoTrackingWanted || localStorage.getItem('osanpoState') !== 'walk') return;
    if(!window.isSecureContext || !('geolocation' in navigator)) return;

    if(geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
    if(resetBase) lastGeoPoint = null;
    geoUsingFallback = Boolean(useFallback);

    const options = geoUsingFallback
      ? { enableHighAccuracy:false, maximumAge:10000, timeout:20000 }
      : { enableHighAccuracy:true, maximumAge:3000, timeout:15000 };

    setGpsStatus(geoUsingFallback ? '位置情報を標準精度で再接続しています…' : '位置情報を確認しています…', 'waiting', true);
    geoWatchId = navigator.geolocation.watchPosition(onGeoSuccess, onGeoError, options);
    armGeoWatchdog();
  }

  function startLocationTracking({ resetBase=true } = {}){
    stopLocationTracking({ resetPoint:resetBase, disableWanted:false });

    if(!window.isSecureContext){
      setGpsStatus('位置情報はHTTPSで開いたときに利用できます。タイマーは通常どおり進みます。', 'error');
      return;
    }
    if(!('geolocation' in navigator)){
      setGpsStatus('このブラウザでは位置情報を利用できません。タイマーは通常どおり進みます。', 'error');
      return;
    }

    geoTrackingWanted = true;
    geoConsecutiveErrors = 0;
    restartGeoWatch(false, resetBase);
  }

  function stopLocationTracking({ resetPoint=true, disableWanted=true } = {}){
    clearGeoTimers();
    if(geoWatchId !== null && 'geolocation' in navigator){
      navigator.geolocation.clearWatch(geoWatchId);
    }
    geoWatchId = null;
    geoUsingFallback = false;
    geoConsecutiveErrors = 0;
    if(resetPoint) lastGeoPoint = null;
    if(disableWanted) geoTrackingWanted = false;
  }

  function retryLocationTracking(){
    if(localStorage.getItem('osanpoState') !== 'walk') return;
    geoTrackingWanted = true;
    geoConsecutiveErrors = 0;
    setGpsStatus('位置情報をもう一度確認しています…', 'waiting');
    restartGeoWatch(false, false);
  }

  function finishWalk(){
    clearInterval(timerId); timerId = null;
    stopLocationTracking();
    localStorage.removeItem('osanpoEndAt'); // 第2版互換キー
    localStorage.setItem('osanpoState','returned');
    show('returned');
  }

  function tick(){
    const end = effectiveEndAt();
    const left = end - Date.now();
    $('timer').textContent = format(left);
    syncWalkUI();
    if(left <= 0) finishWalk();
  }

  function startWalk(){
    chooseTrip();
    const start = Date.now();
    localStorage.setItem('osanpoWalkStartAt', String(start));
    localStorage.setItem('osanpoBaseEndAt', String(start + BASE_WALK_MS));
    localStorage.setItem('osanpoWalkDistanceM', '0');
    localStorage.removeItem('osanpoEndAt');
    localStorage.setItem('osanpoState','walk');
    show('walk');
    syncWalkUI();
    tick();
    clearInterval(timerId);
    timerId = setInterval(tick, 250);
    startLocationTracking();
  }

  function saveAlbum(){
    if(!loadCurrentTrip()) return;
    const owned = ownedMap();
    if(!owned[currentTrip.id]){
      owned[currentTrip.id] = { obtainedAt:new Date().toISOString() };
      localStorage.setItem('osanpoOwnedSpots', JSON.stringify(owned));
    }
    $('photoBadge').hidden = true;
    $('photoStatus').textContent = '新しい写真をアルバムに追加しました！';
    $('saveBtn').textContent = '保存しました ✓';
    $('saveBtn').disabled = true;
    updateHomeCount();
  }

  function renderAlbum(){
    const owned = ownedMap();
    const root = $('albumList');
    root.innerHTML = '';
    const total = Object.keys(owned).length;
    $('albumSummary').textContent = `${total} / ${trips.length}`;

    areaOrder.forEach(area => {
      const spots = trips.filter(t => t.area === area);
      const areaOwned = spots.filter(t => owned[t.id]).length;
      const section = document.createElement('section');
      section.className = 'album-section';

      const heading = document.createElement('div');
      heading.className = 'album-heading';
      heading.innerHTML = `<h3>${area}</h3><span class="area-count">${areaOwned} / ${spots.length}</span>`;
      section.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'album-grid';

      spots.forEach(spot => {
        const data = owned[spot.id];
        const card = document.createElement('div');
        if(data){
          const d = new Date(data.obtainedAt);
          card.className = 'album-card';
          card.tabIndex = 0;
          card.setAttribute('role','button');
          card.setAttribute('aria-label',`${spot.place}の写真を拡大表示`);
          card.innerHTML = `
            <img src="${spot.image}" alt="${spot.place}">
            <div class="card-body">
              <strong>${spot.place}</strong>
              <div class="obtained">${d.toLocaleDateString('ja-JP')} に発見</div>
            </div>`;
          card.addEventListener('click', () => openPhotoModal(spot, data.obtainedAt));
          card.addEventListener('keydown', e => {
            if(e.key === 'Enter' || e.key === ' '){
              e.preventDefault();
              openPhotoModal(spot, data.obtainedAt);
            }
          });
        } else {
          card.className = 'album-card locked';
          card.innerHTML = `<div class="question">？？？</div><div class="locked-name">まだ見つけていません</div>`;
        }
        grid.appendChild(card);
      });

      section.appendChild(grid);
      root.appendChild(section);
    });
  }

  function clearWalkSession(){
    ['osanpoWalkStartAt','osanpoBaseEndAt','osanpoWalkDistanceM','osanpoEndAt'].forEach(k => localStorage.removeItem(k));
  }

  function goHome(){
    stopLocationTracking();
    localStorage.setItem('osanpoState','home');
    localStorage.removeItem('osanpoCurrentTripId');
    clearWalkSession();
    currentTrip = null;
    updateHomeCount();
    show('home');
  }

  function restore(){
    paintName();
    updateHomeCount();
    syncWalkUI();
    const state = localStorage.getItem('osanpoState') || 'home';

    if(state === 'walk'){
      // 第2版の進行中データが残っていた場合の簡易移行
      if(!localStorage.getItem('osanpoWalkStartAt')){
        const oldEnd = Number(localStorage.getItem('osanpoEndAt') || 0);
        const inferredStart = oldEnd ? oldEnd - BASE_WALK_MS : Date.now();
        localStorage.setItem('osanpoWalkStartAt', String(inferredStart));
        localStorage.setItem('osanpoBaseEndAt', String(oldEnd || (inferredStart + BASE_WALK_MS)));
        localStorage.setItem('osanpoWalkDistanceM', localStorage.getItem('osanpoWalkDistanceM') || '0');
      }

      if(effectiveEndAt() > Date.now()){
        show('walk');
        tick();
        timerId = setInterval(tick,250);
        // 画面を再度開いた地点から計測を再開。閉じていた間の移動は加算しない。
        startLocationTracking();
        return;
      }
      finishWalk();
      return;
    }

    if(state === 'returned') show('returned'); else show('home');
  }

  $('nameSaveBtn').addEventListener('click', saveName);
  $('nameInput').addEventListener('keydown', e => { if(e.key==='Enter') saveName(); });
  $('goBtn').addEventListener('click', startWalk);
  $('showPhotoBtn').addEventListener('click', () => { renderTrip(); show('photo'); });
  $('saveBtn').addEventListener('click', saveAlbum);
  $('homeBtn').addEventListener('click', goHome);
  $('albumBtn').addEventListener('click', () => { renderAlbum(); show('album'); });
  $('backBtn').addEventListener('click', () => show('home'));
  $('photoModalClose').addEventListener('click', closePhotoModal);
  $('photoModal').addEventListener('click', e => { if(e.target === $('photoModal')) closePhotoModal(); });
  $('gpsRetryBtn').addEventListener('click', retryLocationTracking);
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && $('photoModal').classList.contains('show')) closePhotoModal(); });

  document.addEventListener('visibilitychange', () => {
    if(localStorage.getItem('osanpoState') !== 'walk') return;
    if(document.visibilityState === 'hidden'){
      // iOS SafariはバックグラウンドGPSを保証しないため、明示的に一時停止。
      // lastGeoPointも捨て、復帰後の大ジャンプを距離に数えない。
      stopLocationTracking({ resetPoint:true, disableWanted:false });
      return;
    }
    geoTrackingWanted = true;
    startLocationTracking({ resetBase:true });
    tick();
  });

  window.addEventListener('pageshow', e => {
    // SafariのBFCacheから戻った場合も位置情報を取り直す。通常の初回loadではrestore()に任せる。
    if(e.persisted && localStorage.getItem('osanpoState') === 'walk'){
      geoTrackingWanted = true;
      startLocationTracking({ resetBase:true });
      tick();
    }
  });

  window.addEventListener('online', () => {
    if(localStorage.getItem('osanpoState') === 'walk' && document.visibilityState === 'visible'){
      retryLocationTracking();
    }
  });

  restore();
  openNameIfNeeded();
})();
