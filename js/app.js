(() => {
  const TEST_MODE = new URLSearchParams(location.search).get('test') === '1';
  const BASE_WALK_MS = TEST_MODE ? 60 * 1000 : 30 * 60 * 1000;
  const MIN_WALK_MS = TEST_MODE ? 20 * 1000 : 10 * 60 * 1000;
  const DISTANCE_STEP_M = TEST_MODE ? 10 : 100;
  const SHORTEN_STEP_MS = TEST_MODE ? 5 * 1000 : 60 * 1000;
  const MAX_SHORTEN_MS = BASE_WALK_MS - MIN_WALK_MS;
  const GEO_STALE_MS = 30 * 1000;
  const GEO_RETRY_MS = 8 * 1000;
  const GEO_HIGH_ACCURACY_FAILS_BEFORE_FALLBACK = 3;

  const screens = [...document.querySelectorAll('.screen')];
  const $ = (id) => document.getElementById(id);
  let timerId = null;
  let currentTrip = null;
  let currentSouvenir = null;
  let geoWatchId = null;
  let geoRetryTimer = null;
  let geoStaleTimer = null;
  let lastGeoPoint = null;
  let lastGeoSuccessAt = 0;
  let geoFailCount = 0;
  let usingHighAccuracy = true;
  let walkToastTimer = null;

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
  const SOUVENIR_CHANCE = 0.40;
  const souvenirs = [
    { id:'tokyo_ningyoyaki', area:'東京', name:'浅草の人形焼き', message:'かわいい形のお菓子、見つけたよ！', image:'assets/souvenirs/tokyo_ningyoyaki.jpg' },
    { id:'tokyo_kaminariokoshi', area:'東京', name:'雷おこし', message:'カリカリしてて、いい音がしそう！', image:'assets/souvenirs/tokyo_kaminariokoshi.jpg' },
    { id:'tokyo_taiyaki', area:'東京', name:'たい焼き', message:'お魚みたいだけど、おやつなんだって！', image:'assets/souvenirs/tokyo_taiyaki.jpg' },
    { id:'kyoto_yatsuhashi', area:'京都', name:'生八つ橋', message:'もちもちで、やわらかそうだったよ！', image:'assets/souvenirs/kyoto_yatsuhashi.jpg' },
    { id:'kyoto_matcha_wagashi', area:'京都', name:'抹茶の上生菓子', message:'きれいな緑のお菓子を見つけたよ！', image:'assets/souvenirs/kyoto_matcha_wagashi.jpg' },
    { id:'kyoto_seasonal_wagashi', area:'京都', name:'季節の和菓子', message:'お花みたいで、ちょっと見とれちゃった！', image:'assets/souvenirs/kyoto_seasonal_wagashi.jpg' },
    { id:'hokkaido_melon', area:'北海道', name:'北海道メロン', message:'あま〜いにおいがしたよ！', image:'assets/souvenirs/hokkaido_melon.jpg' },
    { id:'hokkaido_corn', area:'北海道', name:'とうもろこし', message:'つぶつぶがいっぱいで、おいしそう！', image:'assets/souvenirs/hokkaido_corn.jpg' },
    { id:'hokkaido_milk_sweets', area:'北海道', name:'ミルクのお菓子', message:'やさしい甘さのお菓子みたいだよ！', image:'assets/souvenirs/hokkaido_milk_sweets.jpg' }
  ];


  function show(id){
    screens.forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo(0,0);
  }

  function catName(){ return localStorage.getItem('osanpoCatName') || 'ねこ'; }
  function paintName(){ document.querySelectorAll('.cat-name').forEach(el => el.textContent = catName()); }

  function openNameIfNeeded(){ if(!localStorage.getItem('osanpoCatName')) $('nameModal').classList.add('show'); }
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
  function updateHomeCount(){ $('homeAlbumCount').textContent = `${ownedCount()} / ${trips.length}`; }

  function souvenirMap(){
    try{ return JSON.parse(localStorage.getItem('osanpoOwnedSouvenirs') || '{}'); }
    catch(e){ return {}; }
  }
  function souvenirCount(){ return Object.keys(souvenirMap()).length; }
  function updateHomeSouvenirCount(){ $('homeSouvenirCount').textContent = `${souvenirCount()} / ${souvenirs.length}`; }
  function chooseSouvenirForTrip(){
    const trip = loadCurrentTrip();
    currentSouvenir = null;
    localStorage.removeItem('osanpoCurrentSouvenirId');
    localStorage.removeItem('osanpoSouvenirWasNew');
    localStorage.setItem('osanpoSouvenirAwarded','0');
    if(!trip || Math.random() >= SOUVENIR_CHANCE) return;
    const choices = souvenirs.filter(s => s.area === trip.area);
    currentSouvenir = choices[Math.floor(Math.random()*choices.length)] || null;
    if(currentSouvenir) localStorage.setItem('osanpoCurrentSouvenirId', currentSouvenir.id);
  }
  function loadCurrentSouvenir(){
    if(currentSouvenir) return currentSouvenir;
    const id = localStorage.getItem('osanpoCurrentSouvenirId');
    currentSouvenir = souvenirs.find(s => s.id === id) || null;
    return currentSouvenir;
  }
  function awardSouvenirOnce(){
    const s = loadCurrentSouvenir();
    if(!s || localStorage.getItem('osanpoSouvenirAwarded') === '1') return;
    const owned = souvenirMap();
    const wasNew = !owned[s.id];
    if(wasNew){ owned[s.id] = { obtainedAt:new Date().toISOString(), count:1 }; }
    else { owned[s.id].count = Number(owned[s.id].count||1) + 1; }
    localStorage.setItem('osanpoOwnedSouvenirs',JSON.stringify(owned));
    localStorage.setItem('osanpoSouvenirWasNew',wasNew ? '1':'0');
    localStorage.setItem('osanpoSouvenirAwarded','1');
    updateHomeSouvenirCount();
  }
  function updateReturnSouvenirHint(){
    const has = !!loadCurrentSouvenir();
    $('returnSouvenirHint').hidden = !has;
    $('souvenirBtn').hidden = !has;
  }
  function renderSouvenir(){
    const s = loadCurrentSouvenir();
    if(!s){ goHome(); return; }
    awardSouvenirOnce();
    const wasNew = localStorage.getItem('osanpoSouvenirWasNew') === '1';
    $('souvenirImage').src = s.image;
    $('souvenirImage').alt = `${s.name}のおみやげ画像`;
    $('souvenirArea').textContent = s.area;
    $('souvenirName').textContent = s.name;
    $('souvenirLine').textContent = s.message;
    $('souvenirBadge').hidden = !wasNew;
    $('souvenirStatus').textContent = wasNew ? '新しいおみやげを見つけました！' : 'これ、前にも持ってきた気がする。';
  }
  function renderSouvenirBook(){
    const owned = souvenirMap();
    const root = $('souvenirList');
    root.innerHTML = '';
    $('souvenirSummary').textContent = `${Object.keys(owned).length} / ${souvenirs.length}`;
    areaOrder.forEach(area => {
      const items = souvenirs.filter(s => s.area===area);
      const areaOwned = items.filter(s => owned[s.id]).length;
      const section = document.createElement('section');
      section.className = 'album-section';
      const heading = document.createElement('div');
      heading.className = 'album-heading';
      heading.innerHTML = `<h3>${area}</h3><span class="area-count">${areaOwned} / ${items.length}</span>`;
      section.appendChild(heading);
      const grid = document.createElement('div'); grid.className='album-grid souvenir-grid';
      items.forEach(s => {
        const data = owned[s.id];
        const card = document.createElement('div');
        if(data){
          const d = new Date(data.obtainedAt);
          card.className='album-card souvenir-card';
          card.innerHTML = `<img src="${s.image}" alt="${s.name}"><div class="card-body"><strong>${s.name}</strong><div class="souvenir-card-line">${s.message}</div><div class="obtained">${d.toLocaleDateString('ja-JP')} に発見${Number(data.count||1)>1 ? ` ・ ×${Number(data.count)}` : ''}</div></div>`;
        } else {
          card.className='album-card locked souvenir-card';
          card.innerHTML='<div class="question">？？？</div><div class="locked-name">まだ見つけていません</div>';
        }
        grid.appendChild(card);
      });
      section.appendChild(grid); root.appendChild(section);
    });
  }


  function dateKey(d = new Date()){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function recordsMap(){
    try{ return JSON.parse(localStorage.getItem('osanpoDailyRecords') || '{}'); }
    catch(e){ return {}; }
  }
  function saveRecords(records){ localStorage.setItem('osanpoDailyRecords', JSON.stringify(records)); }
  function blankRecord(){ return {distanceM:0, shortenedSec:0, trips:0, photos:0, places:{}}; }
  function getRecord(key = dateKey()){
    const all = recordsMap();
    return all[key] || blankRecord();
  }
  function mutateRecord(key, fn){
    const all = recordsMap();
    const rec = all[key] || blankRecord();
    fn(rec);
    all[key] = rec;
    saveRecords(all);
    updateHomeRecordMini();
  }
  function addTodayDistance(delta){
    if(delta <= 0) return;
    mutateRecord(dateKey(), rec => { rec.distanceM = Math.max(0, Number(rec.distanceM||0) + delta); });
  }
  function addTodayShorten(deltaSec){
    if(deltaSec <= 0) return;
    mutateRecord(dateKey(), rec => { rec.shortenedSec = Math.max(0, Number(rec.shortenedSec||0) + deltaSec); });
  }
  function logCompletedTripOnce(){
    if(localStorage.getItem('osanpoTripLogged') === '1') return;
    const trip = loadCurrentTrip();
    if(!trip) return;
    mutateRecord(dateKey(), rec => {
      rec.trips = Number(rec.trips||0) + 1;
      rec.photos = Number(rec.photos||0) + 1;
      rec.places = rec.places || {};
      rec.places[trip.id] = Number(rec.places[trip.id]||0) + 1;
    });
    localStorage.setItem('osanpoTripLogged','1');
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
  function formatDistance(m){
    const val = Math.max(0, Number(m)||0);
    if(val >= 1000) return `${(val/1000).toFixed(val >= 10000 ? 1 : 2).replace(/0+$/,'').replace(/\.$/,'')} km`;
    return `${Math.round(val)} m`;
  }
  function formatShort(sec){
    sec = Math.max(0, Math.round(Number(sec)||0));
    if(sec < 60) return `${sec}秒`;
    const m = Math.floor(sec/60), s = sec%60;
    return s ? `${m}分${s}秒` : `${m}分`;
  }

  function tripStartAt(){ return Number(localStorage.getItem('osanpoStartAt') || 0); }
  function walkDistance(){ return Number(localStorage.getItem('osanpoWalkDistanceM') || 0); }
  function walkShortenedMs(){ return Number(localStorage.getItem('osanpoWalkShortenedMs') || 0); }

  function updateWalkStats(){
    $('distance').textContent = formatDistance(walkDistance());
    $('shortened').textContent = formatShort(walkShortenedMs()/1000);
  }

  function effectiveEndAt(){
    const start = tripStartAt();
    if(!start) return 0;
    const normalEnd = start + BASE_WALK_MS;
    const minEnd = start + MIN_WALK_MS;
    return Math.max(minEnd, normalEnd - Math.min(MAX_SHORTEN_MS, walkShortenedMs()));
  }

  function finishWalk(){
    stopGeo();
    clearInterval(timerId); timerId = null;
    localStorage.removeItem('osanpoEndAt');
    localStorage.setItem('osanpoState','returned');
    logCompletedTripOnce();
    awardSouvenirOnce();
    updateReturnSouvenirHint();
    show('returned');
  }

  function tick(){
    const end = effectiveEndAt();
    localStorage.setItem('osanpoEndAt', String(end));
    const left = end - Date.now();
    $('timer').textContent = format(left);
    updateWalkStats();
    if(left <= 0) finishWalk();
  }

  function startWalk(){
    chooseTrip();
    chooseSouvenirForTrip();
    const now = Date.now();
    localStorage.setItem('osanpoStartAt', String(now));
    localStorage.setItem('osanpoEndAt', String(now + BASE_WALK_MS));
    localStorage.setItem('osanpoWalkDistanceM','0');
    localStorage.setItem('osanpoWalkShortenedMs','0');
    localStorage.setItem('osanpoTripLogged','0');
    localStorage.setItem('osanpoState','walk');
    show('walk');
    $('walkRuleNote').textContent = TEST_MODE ? 'テスト：60秒／10mごとに5秒短縮／最短20秒' : '外出30分／100mごとに1分短縮／最短10分';
    tick();
    clearInterval(timerId);
    timerId = setInterval(tick, 250);
    startGeo(true);
  }

  function haversine(a,b){
    const R = 6371000;
    const toRad = d => d*Math.PI/180;
    const dLat = toRad(b.lat-a.lat), dLon = toRad(b.lon-a.lon);
    const la1 = toRad(a.lat), la2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }

  function setGpsStatus(text, state='loading'){
    const el = $('gpsStatus');
    el.textContent = text;
    el.dataset.state = state;
  }

  function scheduleGeoRetry(){
    clearTimeout(geoRetryTimer);
    geoRetryTimer = setTimeout(() => {
      if(localStorage.getItem('osanpoState') === 'walk') startGeo(false);
    }, GEO_RETRY_MS);
  }

  function stopGeo(){
    if(geoWatchId !== null && navigator.geolocation){ navigator.geolocation.clearWatch(geoWatchId); }
    geoWatchId = null;
    clearTimeout(geoRetryTimer); geoRetryTimer = null;
    clearInterval(geoStaleTimer); geoStaleTimer = null;
  }

  function startGeo(forceFresh=false){
    if(localStorage.getItem('osanpoState') !== 'walk') return;
    if(!navigator.geolocation){
      setGpsStatus('このブラウザでは位置情報を利用できません。','error');
      $('gpsRetryBtn').hidden = false;
      return;
    }
    stopGeo();
    if(forceFresh || (Date.now()-lastGeoSuccessAt > 2*60*1000)) lastGeoPoint = null;
    setGpsStatus(usingHighAccuracy ? '位置情報取得中。いっしょに歩いています…' : '位置情報を再取得中…','loading');
    $('gpsRetryBtn').hidden = true;

    const options = {
      enableHighAccuracy: usingHighAccuracy,
      maximumAge: usingHighAccuracy ? 5000 : 15000,
      timeout: usingHighAccuracy ? 12000 : 18000
    };

    geoWatchId = navigator.geolocation.watchPosition(pos => {
      const now = Date.now();
      lastGeoSuccessAt = now;
      geoFailCount = 0;
      const p = {lat:pos.coords.latitude, lon:pos.coords.longitude, accuracy:pos.coords.accuracy, at:now};
      setGpsStatus(`位置情報取得中。いっしょに歩いています…${Math.round(p.accuracy)}m精度`,'ok');
      $('gpsRetryBtn').hidden = true;

      if(p.accuracy > 120){ return; }
      if(!lastGeoPoint){ lastGeoPoint = p; return; }

      const ageSec = Math.max(0.5,(p.at-lastGeoPoint.at)/1000);
      const segment = haversine(lastGeoPoint,p);
      const speed = segment/ageSec;

      if(segment < 4){ return; }
      if(speed > 5.5){ lastGeoPoint = p; return; }
      if(segment > 250){ lastGeoPoint = p; return; }

      lastGeoPoint = p;
      const oldDistance = walkDistance();
      const newDistance = oldDistance + segment;
      localStorage.setItem('osanpoWalkDistanceM', String(newDistance));
      addTodayDistance(segment);

      const oldSteps = Math.floor(oldDistance / DISTANCE_STEP_M);
      const newSteps = Math.floor(newDistance / DISTANCE_STEP_M);
      const earnedSteps = Math.max(0,newSteps-oldSteps);
      if(earnedSteps){
        const oldShort = walkShortenedMs();
        const add = Math.min(MAX_SHORTEN_MS-oldShort, earnedSteps*SHORTEN_STEP_MS);
        if(add > 0){
          localStorage.setItem('osanpoWalkShortenedMs', String(oldShort+add));
          addTodayShorten(add/1000);
          showWalkToast(`${catName()}、うれしくて足どりが軽いみたい！ 帰宅が${formatShort(add/1000)}早くなりました。`);
        }
      }
      tick();
    }, err => {
      geoFailCount++;
      let message = '位置情報を一時的に取得できません。再試行します…';
      if(err.code === 1){
        message = '位置情報の利用が許可されていません。Safariの位置情報設定をご確認ください。';
        $('gpsRetryBtn').hidden = false;
      }
      setGpsStatus(message, err.code===1 ? 'error' : 'warn');
      if(err.code !== 1){
        if(usingHighAccuracy && geoFailCount >= GEO_HIGH_ACCURACY_FAILS_BEFORE_FALLBACK){ usingHighAccuracy = false; }
        scheduleGeoRetry();
      }
    }, options);

    geoStaleTimer = setInterval(() => {
      if(lastGeoSuccessAt && Date.now()-lastGeoSuccessAt > GEO_STALE_MS){
        setGpsStatus('位置情報の応答が止まったため、再接続しています…','warn');
        startGeo(false);
      }
    }, 10000);
  }

  function showWalkToast(text){
    const el = $('walkToast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(walkToastTimer);
    walkToastTimer = setTimeout(() => { el.hidden = true; }, 6000);
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

  function openPhotoModal(spot,data){
    const d = new Date(data.obtainedAt);
    $('modalPhotoImage').src = spot.image;
    $('modalPhotoImage').alt = `${spot.place}の旅写真`;
    $('modalPhotoArea').textContent = spot.area;
    $('modalPhotoName').textContent = spot.place;
    $('modalPhotoMessage').textContent = spot.message;
    $('modalPhotoDate').textContent = `${d.toLocaleDateString('ja-JP')} に発見`;
    $('photoModal').classList.add('show');
    $('photoModal').setAttribute('aria-hidden','false');
  }
  function closePhotoModal(){
    $('photoModal').classList.remove('show');
    $('photoModal').setAttribute('aria-hidden','true');
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
          card.className = 'album-card clickable';
          card.tabIndex = 0;
          card.setAttribute('role','button');
          card.setAttribute('aria-label',`${spot.place}の写真を拡大表示`);
          card.innerHTML = `<img src="${spot.image}" alt="${spot.place}"><div class="card-body"><strong>${spot.place}</strong><div class="obtained">${d.toLocaleDateString('ja-JP')} に発見</div></div>`;
          const open = () => openPhotoModal(spot,data);
          card.addEventListener('click',open);
          card.addEventListener('keydown',e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();open();} });
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

  function recordPlacesText(rec){
    const entries = Object.entries(rec.places||{});
    if(!entries.length) return [];
    return entries.map(([id,count]) => {
      const t = trips.find(x => x.id===id);
      return t ? {name:t.place,count:Number(count)||1} : null;
    }).filter(Boolean);
  }

  function updateHomeRecordMini(){
    const rec = getRecord();
    $('homeTodayDistance').textContent = formatDistance(rec.distanceM||0);
    $('homeTodayTrips').textContent = `${Number(rec.trips||0)} 回`;
  }

  function renderRecords(){
    const all = recordsMap();
    const todayKey = dateKey();
    const today = all[todayKey] || blankRecord();
    const d = new Date();
    $('recordTodayDate').textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
    $('recordTodayDistance').textContent = formatDistance(today.distanceM||0);
    $('recordTodayShortened').textContent = formatShort(today.shortenedSec||0);
    $('recordTodayTrips').textContent = `${Number(today.trips||0)}回`;
    $('recordTodayPhotos').textContent = `${Number(today.photos||0)}枚`;

    const places = recordPlacesText(today);
    const placeRoot = $('recordTodayPlaces');
    placeRoot.innerHTML = '';
    if(!places.length){ placeRoot.innerHTML = '<span class="empty-place">まだおでかけしていません</span>'; }
    else places.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'place-chip';
      chip.textContent = p.count>1 ? `${p.name} ×${p.count}` : p.name;
      placeRoot.appendChild(chip);
    });

    let totalDistance = 0, totalTrips = 0;
    Object.values(all).forEach(rec => {
      totalDistance += Number(rec.distanceM||0);
      totalTrips += Number(rec.trips||0);
    });
    $('recordTotalDistance').textContent = formatDistance(totalDistance);
    $('recordTotalTrips').textContent = `${totalTrips}回`;

    const history = $('recordHistory');
    history.innerHTML = '';
    const keys = Object.keys(all).sort().reverse().slice(0,10);
    if(!keys.length){ history.innerHTML = '<div class="empty-history">記録はまだありません。</div>'; return; }
    keys.forEach(key => {
      const rec = all[key];
      if(!(Number(rec.trips||0) || Number(rec.distanceM||0))) return;
      const [y,m,day] = key.split('-').map(Number);
      const row = document.createElement('div');
      row.className = 'history-row';
      const names = recordPlacesText(rec).map(p => p.count>1 ? `${p.name}×${p.count}` : p.name);
      row.innerHTML = `<div><strong>${m}/${day}</strong><div class="history-places">${names.length ? names.join('・') : '猫とは歩いたけれど、おでかけ完了前'}</div></div><div class="history-right"><span>${formatDistance(rec.distanceM||0)}</span><small>${Number(rec.trips||0)}回</small></div>`;
      history.appendChild(row);
    });
  }

  function goHome(){
    stopGeo();
    localStorage.setItem('osanpoState','home');
    localStorage.removeItem('osanpoCurrentTripId');
    localStorage.removeItem('osanpoStartAt');
    localStorage.removeItem('osanpoEndAt');
    localStorage.removeItem('osanpoWalkDistanceM');
    localStorage.removeItem('osanpoWalkShortenedMs');
    localStorage.removeItem('osanpoTripLogged');
    localStorage.removeItem('osanpoCurrentSouvenirId');
    localStorage.removeItem('osanpoSouvenirAwarded');
    localStorage.removeItem('osanpoSouvenirWasNew');
    currentTrip = null;
    currentSouvenir = null;
    updateHomeCount();
    updateHomeRecordMini();
    updateHomeSouvenirCount();
    show('home');
  }

  function restore(){
    paintName();
    updateHomeCount();
    updateHomeRecordMini();
    updateHomeSouvenirCount();
    const state = localStorage.getItem('osanpoState') || 'home';
    if(state === 'walk'){
      const end = effectiveEndAt();
      if(end > Date.now()){
        show('walk');
        $('walkRuleNote').textContent = TEST_MODE ? 'テスト：60秒／10mごとに5秒短縮／最短20秒' : '外出30分／100mごとに1分短縮／最短10分';
        tick(); timerId = setInterval(tick,250); startGeo(true); return;
      }
      localStorage.setItem('osanpoState','returned');
      logCompletedTripOnce();
      awardSouvenirOnce();
      updateReturnSouvenirHint();
      show('returned'); return;
    }
    if(state === 'returned'){ logCompletedTripOnce(); awardSouvenirOnce(); updateReturnSouvenirHint(); show('returned'); }
    else show('home');
  }

  $('nameSaveBtn').addEventListener('click', saveName);
  $('nameInput').addEventListener('keydown', e => { if(e.key==='Enter') saveName(); });
  $('goBtn').addEventListener('click', startWalk);
  $('gpsRetryBtn').addEventListener('click', () => { usingHighAccuracy = true; geoFailCount = 0; startGeo(true); });
  $('showPhotoBtn').addEventListener('click', () => { renderTrip(); show('photo'); });
  $('saveBtn').addEventListener('click', saveAlbum);
  $('souvenirBtn').addEventListener('click', () => { renderSouvenir(); show('souvenir'); });
  $('souvenirToBookBtn').addEventListener('click', () => { renderSouvenirBook(); show('souvenirBook'); });
  $('souvenirHomeBtn').addEventListener('click', goHome);
  $('homeBtn').addEventListener('click', goHome);
  $('albumBtn').addEventListener('click', () => { renderAlbum(); show('album'); });
  $('souvenirBookBtn').addEventListener('click', () => { renderSouvenirBook(); show('souvenirBook'); });
  $('souvenirBackBtn').addEventListener('click', goHome);
  $('backBtn').addEventListener('click', () => show('home'));
  $('recordBtn').addEventListener('click', () => { renderRecords(); show('record'); });
  $('recordBackBtn').addEventListener('click', () => show('home'));
  $('photoModalClose').addEventListener('click', closePhotoModal);
  document.querySelectorAll('[data-close-photo]').forEach(el => el.addEventListener('click',closePhotoModal));
  document.addEventListener('keydown',e => { if(e.key==='Escape') closePhotoModal(); });
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && localStorage.getItem('osanpoState') === 'walk') startGeo(true);
  });
  window.addEventListener('pageshow', () => {
    if(localStorage.getItem('osanpoState') === 'walk') startGeo(true);
  });
  window.addEventListener('beforeunload', stopGeo);

  restore();
  openNameIfNeeded();
})();
