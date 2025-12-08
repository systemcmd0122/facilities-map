let map;
let allFacilities = [];
let facilityMarkers = [];
let pinMarker = null;
let radiusCircle = null;
let pinMode = false;
let pinSearchResults = [];
let savedData = [];
let filteredSavedData = [];
let currentTab = 'search';
let currentSort = 'newest';
let currentSearchFilter = '';
let facilityMemos = {}; // 施設ごとのメモを保存するオブジェクト
let currentEditingMemoFacility = null; // 現在編集中のメモの施設
let currentPinInfo = null; // 現在のピンの情報(name, memo, timestamp)
let facilityColors = {}; // 施設ごとのカスタムカラーを保存するオブジェクト

const DB_NAME = 'FacilitiesMapDB';
const DB_VERSION = 3; // バージョンをアップグレード（色保存用）
const STORE_NAME = 'searches';
const MEMO_STORE_NAME = 'memos'; // メモ用のストア
const COLOR_STORE_NAME = 'colors'; // 色用のストア
let db;

// タブ切り替え機能
function initTabs() {
	document.querySelectorAll('.tab').forEach(tab => {
		tab.addEventListener('click', () => {
			const tabName = tab.dataset.tab;
			currentTab = tabName;

			document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
			document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

			tab.classList.add('active');
			document.getElementById(tabName + '-tab').classList.add('active');
		});
	});
}

// IndexedDB初期化
async function initIndexedDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			db = request.result;
			loadSavedData();
			loadAllMemos();
			loadAllColors();
			resolve();
		};
		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
			}
			if (!db.objectStoreNames.contains(MEMO_STORE_NAME)) {
				db.createObjectStore(MEMO_STORE_NAME, { keyPath: 'facilityId' });
			}
			if (!db.objectStoreNames.contains(COLOR_STORE_NAME)) {
				db.createObjectStore(COLOR_STORE_NAME, { keyPath: 'facilityId' });
			}
		};
	});
}

// マップ初期化
function initMap() {
	map = L.map('map').setView([36.5, 140.5], 8);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '© OpenStreetMap',
		maxZoom: 19
	}).addTo(map);

	map.on('click', (e) => {
		if (pinMode) {
			pinPoint(e.latlng.lat, e.latlng.lng);
		}
	});
}

// データ読み込み
async function loadFacilities() {
	const prefectures = ['茨城', '群馬', '山梨', '新潟', '長野', '栃木', '富山'];
	for (const pref of prefectures) {
		try {
			const response = await fetch(`./facilities_data/${pref}_facilities.json`);
			if (response.ok) {
				const data = await response.json();
				allFacilities = allFacilities.concat(data);
			}
		} catch (error) {
			console.log(`${pref}を読み込めませんでした`);
		}
	}
	populatePrefectures();
	displayAllFacilities();
}

// 都道府県リスト更新
function populatePrefectures() {
	const select = document.getElementById('prefecture-select');
	const prefectures = ['茨城', '群馬', '山梨', '新潟', '長野', '栃木', '富山'];

	prefectures.forEach(pref => {
		const option = document.createElement('option');
		option.value = pref;
		option.textContent = pref;
		select.appendChild(option);
	});
}

// 距離計算
function calculateDistance(lat1, lon1, lat2, lon2) {
	const R = 6371;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLon = (lon2 - lon1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

// 検索フィルター適用
function applySearchFilters() {
	const nameSearch = document.getElementById('name-search-input').value.toLowerCase();
	const categorySelect = document.getElementById('category-select').value;
	const prefectureSelect = document.getElementById('prefecture-select').value;

	let filtered = allFacilities;

	if (nameSearch) {
		// 施設名、住所の両方で検索
		filtered = filtered.filter(f => 
			f.name.toLowerCase().includes(nameSearch) || 
			f.address.toLowerCase().includes(nameSearch)
		);
	}

	if (categorySelect) {
		filtered = filtered.filter(f => f.category === categorySelect);
	}

	if (prefectureSelect) {
		filtered = filtered.filter(f => f.address.includes(prefectureSelect));
	}

	displayAllFacilities(filtered);
}

// 全施設表示
function displayAllFacilities(facilities = null) {
	const toDisplay = facilities || allFacilities;
	clearMarkers();
	const facilityList = document.getElementById('facility-list');
	const resultCount = document.getElementById('result-count');

	facilityList.innerHTML = '';
	resultCount.textContent = `(${toDisplay.length}件)`;

	if (toDisplay.length === 0) {
		facilityList.innerHTML = '<div class="empty-state">該当施設なし</div>';
		return;
	}

	toDisplay.forEach((facility) => {
		const categoryColor = facility.category === '保育園' ? '#2196F3' :
			facility.category === '幼稚園' ? '#4CAF50' : '#FF9800';

		const facilityId = createFacilityId(facility);
		const hasMemo = facilityMemos[facilityId];
		const customColor = facilityColors[facilityId];

		const marker = L.circleMarker([facility.latitude, facility.longitude], {
			radius: 6,
			fillColor: customColor || (hasMemo ? '#e91e63' : categoryColor),
			color: '#fff',
			weight: 2,
			opacity: 1,
			fillOpacity: 0.8
		}).addTo(map);

		// マーカーにメタデータを保存
		marker.facilityId = facilityId;
		marker.facility = facility;
		marker.categoryColor = categoryColor;

		// ポップアップ作成関数
		function updatePopupContent() {
			const popupContent = document.createElement('div');
			popupContent.className = 'popup-content';

			const currentMemo = facilityMemos[facilityId];

			popupContent.innerHTML = `<h3>${facility.name}</h3><p><strong>種類:</strong> ${facility.category}</p><p><strong>住所:</strong><br>${facility.address.trim()}</p><p><a href="${facility.link}" target="_blank">Google Mapsで開く</a></p>`;

			// メモ入力欄を追加
			const memoSection = document.createElement('div');
			memoSection.style.marginTop = '12px';

			const memoLabel = document.createElement('label');
			memoLabel.style.display = 'block';
			memoLabel.style.marginBottom = '4px';
			memoLabel.style.fontSize = '12px';
			memoLabel.style.fontWeight = '600';
			memoLabel.style.color = '#e91e63';

			const memoTextarea = document.createElement('textarea');
			memoTextarea.value = currentMemo || '';
			memoTextarea.placeholder = 'メモを入力...';
			memoTextarea.style.width = '100%';
			memoTextarea.style.minHeight = '60px';
			memoTextarea.style.padding = '8px';
			memoTextarea.style.border = '1px solid #ddd';
			memoTextarea.style.borderRadius = '4px';
			memoTextarea.style.fontSize = '12px';
			memoTextarea.style.fontFamily = 'inherit';
			memoTextarea.style.resize = 'vertical';
			memoTextarea.style.boxSizing = 'border-box';

			// フォーカス時のスタイル
			memoTextarea.addEventListener('focus', () => {
				memoTextarea.style.borderColor = '#e91e63';
				memoTextarea.style.outline = 'none';
			});

			memoTextarea.addEventListener('blur', () => {
				memoTextarea.style.borderColor = '#ddd';
				const newMemo = memoTextarea.value.trim();
				
				// メモが変更された場合のみ保存
				if (newMemo !== (currentMemo || '')) {
					if (newMemo) {
						saveMemoToDB(facility, newMemo);
					} else {
						deleteMemoFromDB(facility);
					}
				}
			});

			memoSection.appendChild(memoLabel);
			memoSection.appendChild(memoTextarea);
			popupContent.appendChild(memoSection);

			// カラーピッカーセクションを追加
			const colorSection = document.createElement('div');
			colorSection.style.marginTop = '12px';
			colorSection.style.display = 'flex';
			colorSection.style.alignItems = 'center';
			colorSection.style.gap = '8px';

			const colorLabel = document.createElement('label');
			colorLabel.textContent = 'ピンの色:';
			colorLabel.style.fontSize = '12px';
			colorLabel.style.fontWeight = '600';
			colorLabel.style.color = '#666';

			const colorInput = document.createElement('input');
			colorInput.type = 'color';
			const currentColor = facilityColors[facilityId] || (hasMemo ? '#e91e63' : categoryColor);
			colorInput.value = currentColor;
			colorInput.style.width = '50px';
			colorInput.style.height = '30px';
			colorInput.style.border = '1px solid #ddd';
			colorInput.style.borderRadius = '4px';
			colorInput.style.cursor = 'pointer';

			colorInput.addEventListener('change', (e) => {
				const newColor = e.target.value;
				saveColorToDB(facility, newColor);
			});

			const resetColorBtn = document.createElement('button');
			resetColorBtn.textContent = 'リセット';
			resetColorBtn.style.padding = '4px 8px';
			resetColorBtn.style.fontSize = '11px';
			resetColorBtn.style.background = '#f5f5f5';
			resetColorBtn.style.border = '1px solid #ddd';
			resetColorBtn.style.borderRadius = '4px';
			resetColorBtn.style.cursor = 'pointer';
			resetColorBtn.style.transition = 'all 0.2s';

			resetColorBtn.addEventListener('click', () => {
				deleteColorFromDB(facility);
				colorInput.value = hasMemo ? '#e91e63' : categoryColor;
			});

			resetColorBtn.addEventListener('mouseover', () => {
				resetColorBtn.style.background = '#e0e0e0';
			});

			resetColorBtn.addEventListener('mouseout', () => {
				resetColorBtn.style.background = '#f5f5f5';
			});

			colorSection.appendChild(colorLabel);
			colorSection.appendChild(colorInput);
			colorSection.appendChild(resetColorBtn);
			popupContent.appendChild(colorSection);

			return popupContent;
		}

		marker.bindPopup(updatePopupContent());

		// ポップアップを開く際に内容を更新
		marker.on('popupopen', () => {
			marker.setPopupContent(updatePopupContent());
		});

		facilityMarkers.push(marker);

		const li = document.createElement('li');
		li.className = 'facility-item' + (hasMemo ? ' has-memo' : '');
		li.dataset.facilityId = facilityId;

		let memoSection = '';
		if (hasMemo) {
			memoSection = `<div class="memo-display">${escapeHtml(facilityMemos[facilityId])}</div>`;
		}

		li.innerHTML = `
                    <div class="facility-info">
                        <div class="facility-name">${facility.name}${hasMemo ? '<span class="facility-memo-badge">メモあり</span>' : ''}</div>
                        <div class="facility-category">${facility.category}</div>
                        ${memoSection}
                        <div class="memo-input-container">
                            <button class="memo-btn" style="flex: 1;">メモを編集</button>
                        </div>
                    </div>
                `;

		const listMemoBtn = li.querySelector('.memo-btn');
		listMemoBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openMemoModal(facility);
		});

		li.addEventListener('click', () => {
			map.setView([facility.latitude, facility.longitude], 15);
			marker.openPopup();
			highlightItem(li);
		});
		facilityList.appendChild(li);
	});

	if (toDisplay.length > 0) {
		const group = new L.featureGroup(facilityMarkers);
		map.fitBounds(group.getBounds().pad(0.1), { maxZoom: 13 });
	}
}

// ヘルパー関数
function clearMarkers() {
	facilityMarkers.forEach(marker => map.removeLayer(marker));
	facilityMarkers = [];
}

function highlightItem(li) {
	document.querySelectorAll('.facility-item').forEach(item => {
		item.classList.remove('active');
	});
	li.classList.add('active');
}

// HTMLエスケープ関数
function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

// メモ関連の関数
function createFacilityId(facility) {
	return `${facility.address.substring(0, 10)}_${facility.latitude.toFixed(4)}_${facility.longitude.toFixed(4)}_${facility.name.substring(0, 10)}`;
}

function saveMemoToDB(facility, memo) {
	if (!db) return;

	const facilityId = createFacilityId(facility);
	const transaction = db.transaction([MEMO_STORE_NAME], 'readwrite');
	const store = transaction.objectStore(MEMO_STORE_NAME);

	const memoData = {
		facilityId: facilityId,
		facilityName: facility.name,
		facilityCategory: facility.category,
		facilityAddress: facility.address,
		facilityLat: facility.latitude,
		facilityLng: facility.longitude,
		memo: memo,
		timestamp: new Date().toISOString()
	};

	store.put(memoData);

	transaction.oncomplete = () => {
		facilityMemos[facilityId] = memo;
		updateFacilityDisplayWithMemo(facility);
	};
}

function loadAllMemos() {
	if (!db) return;

	const transaction = db.transaction([MEMO_STORE_NAME], 'readonly');
	const store = transaction.objectStore(MEMO_STORE_NAME);
	const request = store.getAll();

	request.onsuccess = () => {
		facilityMemos = {};
		request.result.forEach(memoData => {
			facilityMemos[memoData.facilityId] = memoData.memo;
		});
	};
}

function getMemoForFacility(facility) {
	const facilityId = createFacilityId(facility);
	return facilityMemos[facilityId] || null;
}

function deleteMemoFromDB(facility) {
	if (!db) return;

	const facilityId = createFacilityId(facility);
	const transaction = db.transaction([MEMO_STORE_NAME], 'readwrite');
	const store = transaction.objectStore(MEMO_STORE_NAME);

	store.delete(facilityId);

	transaction.oncomplete = () => {
		delete facilityMemos[facilityId];
		updateFacilityDisplayWithMemo(facility);
	};
}

function updateFacilityDisplayWithMemo(facility) {
	// 施設リスト内の表示を更新
	const facilityId = createFacilityId(facility);
	const memo = facilityMemos[facilityId];

	document.querySelectorAll('.facility-item').forEach(item => {
		if (item.dataset.facilityId === facilityId) {
			if (memo) {
				item.classList.add('has-memo');
			} else {
				item.classList.remove('has-memo');
			}
		}
	});

	// マーカーの色を更新
	facilityMarkers.forEach(marker => {
		if (marker.facilityId === facilityId) {
			const categoryColor = marker.categoryColor;
			const currentMemo = facilityMemos[facilityId];
			const customColor = facilityColors[facilityId];
			marker.setStyle({
				fillColor: customColor || (currentMemo ? '#e91e63' : categoryColor)
			});
		}
	});
}

// 色関連の関数
function loadAllColors() {
	if (!db) return;

	const transaction = db.transaction([COLOR_STORE_NAME], 'readonly');
	const store = transaction.objectStore(COLOR_STORE_NAME);
	const request = store.getAll();

	request.onsuccess = () => {
		facilityColors = {};
		request.result.forEach(colorData => {
			facilityColors[colorData.facilityId] = colorData.color;
		});
	};
}

function saveColorToDB(facility, color) {
	if (!db) return;

	const facilityId = createFacilityId(facility);
	const transaction = db.transaction([COLOR_STORE_NAME], 'readwrite');
	const store = transaction.objectStore(COLOR_STORE_NAME);

	const colorData = {
		facilityId: facilityId,
		facilityName: facility.name,
		facilityCategory: facility.category,
		color: color,
		timestamp: new Date().toISOString()
	};

	store.put(colorData);

	transaction.oncomplete = () => {
		facilityColors[facilityId] = color;
		updateFacilityColor(facility);
	};
}

function deleteColorFromDB(facility) {
	if (!db) return;

	const facilityId = createFacilityId(facility);
	const transaction = db.transaction([COLOR_STORE_NAME], 'readwrite');
	const store = transaction.objectStore(COLOR_STORE_NAME);

	store.delete(facilityId);

	transaction.oncomplete = () => {
		delete facilityColors[facilityId];
		updateFacilityColor(facility);
	};
}

function updateFacilityColor(facility) {
	const facilityId = createFacilityId(facility);
	
	// マーカーの色を更新
	facilityMarkers.forEach(marker => {
		if (marker.facilityId === facilityId) {
			const categoryColor = marker.categoryColor;
			const currentMemo = facilityMemos[facilityId];
			const customColor = facilityColors[facilityId];
			marker.setStyle({
				fillColor: customColor || (currentMemo ? '#e91e63' : categoryColor)
			});
		}
	});
}

function openMemoModal(facility) {
	currentEditingMemoFacility = facility;
	const modal = document.getElementById('memo-modal');
	const input = document.getElementById('memo-input');
	const facilityName = document.getElementById('memo-facility-name');
	const facilityId = createFacilityId(facility);
	const currentMemo = facilityMemos[facilityId] || '';

	facilityName.textContent = `施設: ${facility.name} (${facility.category})`;
	input.value = currentMemo;
	modal.classList.add('active');
	input.focus();
}

function closeMemoModal() {
	const modal = document.getElementById('memo-modal');
	modal.classList.remove('active');
	currentEditingMemoFacility = null;
}

function saveMemo() {
	if (!currentEditingMemoFacility) {
		alert('エラーが発生しました');
		return;
	}

	const memo = document.getElementById('memo-input').value.trim();

	if (memo) {
		saveMemoToDB(currentEditingMemoFacility, memo);
	} else {
		deleteMemoFromDB(currentEditingMemoFacility);
	}

	closeMemoModal();
}

let editingSavedSearchId = null;

function openSavedSearchMemoModal(data) {
	editingSavedSearchId = data.id;
	const modal = document.getElementById('memo-modal');
	const input = document.getElementById('memo-input');
	const facilityName = document.getElementById('memo-facility-name');

	facilityName.textContent = `検索: ${data.name} (座標: ${data.pin[0].toFixed(4)}, ${data.pin[1].toFixed(4)})`;
	input.value = data.memo || '';
	modal.classList.add('active');
	input.focus();
}

function saveSavedSearchMemo() {
	if (editingSavedSearchId === null) {
		alert('エラーが発生しました');
		return;
	}

	const memo = document.getElementById('memo-input').value.trim();
	const transaction = db.transaction([STORE_NAME], 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	const getRequest = store.get(editingSavedSearchId);

	getRequest.onsuccess = () => {
		const data = getRequest.result;
		if (data) {
			data.memo = memo;
			const putRequest = store.put(data);

			putRequest.onsuccess = () => {
				closeMemoModal();
				loadSavedData();
				editingSavedSearchId = null;
			};

			putRequest.onerror = () => {
				alert('更新に失敗しました');
			};
		}
	};

	getRequest.onerror = () => {
		alert('データの取得に失敗しました');
	};
}

// ピンモード切り替え
function togglePinMode() {
	pinMode = !pinMode;
	const btn = document.getElementById('pin-btn');
	const mapEl = document.getElementById('map');
	if (pinMode) {
		btn.classList.add('active');
		mapEl.classList.add('pin-mode');
	} else {
		btn.classList.remove('active');
		mapEl.classList.remove('pin-mode');
	}
}

// ピン指す
function pinPoint(lat, lng, savedInfo = null) {
	if (pinMarker) map.removeLayer(pinMarker);
	if (radiusCircle) map.removeLayer(radiusCircle);

	// 保存された情報があれば保持
	if (savedInfo) {
		currentPinInfo = savedInfo;
	} else {
		currentPinInfo = null;
	}

	pinMarker = L.circleMarker([lat, lng], {
		radius: 8,
		fillColor: '#f44336',
		color: '#fff',
		weight: 2,
		opacity: 1,
		fillOpacity: 0.8
	}).addTo(map);

	// ポップアップを作成
	const createPinPopup = () => {
		const popupContent = document.createElement('div');
		popupContent.className = 'popup-content';
		popupContent.style.minWidth = '200px';

		if (currentPinInfo) {
			// 保存されたピンの場合
			const date = new Date(currentPinInfo.timestamp);
			const dateStr = date.toLocaleDateString('ja-JP') + ' ' + date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

			popupContent.innerHTML = `
				<h3 style="margin: 0 0 8px 0; color: #f44336;">${currentPinInfo.name}</h3>
			`;

			// メモ入力欄を追加
			const memoSection = document.createElement('div');
			memoSection.style.marginTop = '12px';

			const memoLabel = document.createElement('label');
			memoLabel.style.display = 'block';
			memoLabel.style.marginBottom = '4px';
			memoLabel.style.fontSize = '12px';
			memoLabel.style.fontWeight = '600';
			memoLabel.style.color = '#e91e63';

			const memoTextarea = document.createElement('textarea');
			memoTextarea.value = currentPinInfo.memo || '';
			memoTextarea.placeholder = 'メモを入力...';
			memoTextarea.style.width = '100%';
			memoTextarea.style.minHeight = '60px';
			memoTextarea.style.padding = '8px';
			memoTextarea.style.border = '1px solid #ddd';
			memoTextarea.style.borderRadius = '4px';
			memoTextarea.style.fontSize = '12px';
			memoTextarea.style.fontFamily = 'inherit';
			memoTextarea.style.resize = 'vertical';
			memoTextarea.style.boxSizing = 'border-box';

			// フォーカス時のスタイル
			memoTextarea.addEventListener('focus', () => {
				memoTextarea.style.borderColor = '#e91e63';
				memoTextarea.style.outline = 'none';
			});

			memoTextarea.addEventListener('blur', () => {
				memoTextarea.style.borderColor = '#ddd';
				const newMemo = memoTextarea.value.trim();
				
				// メモが変更された場合のみ保存
				if (newMemo !== (currentPinInfo.memo || '')) {
					// currentPinInfo.idを使ってデータベースを更新
					if (db && currentPinInfo.id) {
						const transaction = db.transaction([STORE_NAME], 'readwrite');
						const store = transaction.objectStore(STORE_NAME);
						const getRequest = store.get(currentPinInfo.id);

						getRequest.onsuccess = () => {
							const data = getRequest.result;
							if (data) {
								data.memo = newMemo;
								store.put(data);
								currentPinInfo.memo = newMemo;
								loadSavedData();
							}
						};
					}
				}
			});

			memoSection.appendChild(memoLabel);
			memoSection.appendChild(memoTextarea);
			popupContent.appendChild(memoSection);
		} else {
			// 新しいピンの場合
			popupContent.innerHTML = `
				<h3 style="margin: 0 0 8px 0; color: #f44336;">検索ピン</h3>
				<p style="margin: 4px 0;"><strong>座標:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}</p>
				<p style="margin: 4px 0; font-size: 12px; color: #666;">「保存」ボタンで検索を保存できます</p>
			`;
		}

		return popupContent;
	};

	pinMarker.bindPopup(createPinPopup());

	const radius = parseFloat(document.getElementById('radius-input').value);
	radiusCircle = L.circle([lat, lng], {
		radius: radius * 1000,
		color: '#2196F3',
		weight: 2,
		fill: false,
		dashArray: '5, 5'
	}).addTo(map);

	pinSearchResults = allFacilities.filter(facility => {
		const distance = calculateDistance(lat, lng, facility.latitude, facility.longitude);
		return distance <= radius;
	}).sort((a, b) => {
		const distA = calculateDistance(lat, lng, a.latitude, a.longitude);
		const distB = calculateDistance(lat, lng, b.latitude, b.longitude);
		return distA - distB;
	});

	displayPinSearchResults(lat, lng);
	pinMode = false;
	document.getElementById('pin-btn').classList.remove('active');
	document.getElementById('map').classList.remove('pin-mode');
}

// ピン検索結果表示
function displayPinSearchResults(pinLat, pinLng) {
	const pinInfoDiv = document.getElementById('pin-info');
	const facilityList = document.getElementById('facility-list');

	const nurseries = pinSearchResults.filter(f => f.category === '保育園').length;
	const kindergartens = pinSearchResults.filter(f => f.category === '幼稚園').length;
	const schools = pinSearchResults.filter(f => f.category === '小学校').length;

	pinInfoDiv.innerHTML = `
                <div class="info-box">
                    <p><strong>検索完了</strong></p>
                    <p>座標: ${pinLat.toFixed(4)}, ${pinLng.toFixed(4)}</p>
                    <p>半径: <strong>${document.getElementById('radius-input').value}km</strong></p>
                    <p>合計: <span class="search-count">${pinSearchResults.length}件</span></p>
                    <p>内訳: 保育園${nurseries} / 幼稚園${kindergartens} / 小学校${schools}</p>
                </div>
            `;

	facilityList.innerHTML = '';
	if (pinSearchResults.length === 0) {
		facilityList.innerHTML = '<div class="empty-state">該当施設なし</div>';
		document.getElementById('result-count').textContent = '(0件)';
		return;
	}

	document.getElementById('result-count').textContent = `(${pinSearchResults.length}件)`;

	pinSearchResults.forEach((facility, idx) => {
		const distance = calculateDistance(pinLat, pinLng, facility.latitude, facility.longitude);
		const facilityId = createFacilityId(facility);
		const hasMemo = facilityMemos[facilityId];
		const customColor = facilityColors[facilityId];

		const categoryColor = facility.category === '保育園' ? '#2196F3' :
			facility.category === '幼稚園' ? '#4CAF50' : '#FF9800';

		// マーカーを作成
		const marker = L.circleMarker([facility.latitude, facility.longitude], {
			radius: 6,
			fillColor: customColor || (hasMemo ? '#e91e63' : categoryColor),
			color: '#fff',
			weight: 2,
			opacity: 1,
			fillOpacity: 0.8
		}).addTo(map);

		// マーカーにメタデータを保存
		marker.facilityId = facilityId;
		marker.facility = facility;
		marker.categoryColor = categoryColor;

		// ポップアップ作成関数
		function updatePopupContentForPinSearch() {
			const popupContent = document.createElement('div');
			popupContent.className = 'popup-content';

			const currentMemo = facilityMemos[facilityId];

			popupContent.innerHTML = `<h3>${facility.name}</h3><p><strong>種類:</strong> ${facility.category}</p><p><strong>住所:</strong><br>${facility.address.trim()}</p><p><a href="${facility.link}" target="_blank">Google Mapsで開く</a></p>`;

			// メモ入力欄を追加
			const memoSection = document.createElement('div');
			memoSection.style.marginTop = '12px';

			const memoLabel = document.createElement('label');
			memoLabel.textContent = 'メモ:';
			memoLabel.style.display = 'block';
			memoLabel.style.marginBottom = '4px';
			memoLabel.style.fontSize = '12px';
			memoLabel.style.fontWeight = '600';
			memoLabel.style.color = '#e91e63';

			const memoTextarea = document.createElement('textarea');
			memoTextarea.value = currentMemo || '';
			memoTextarea.placeholder = 'メモを入力...';
			memoTextarea.style.width = '100%';
			memoTextarea.style.minHeight = '60px';
			memoTextarea.style.padding = '8px';
			memoTextarea.style.border = '1px solid #ddd';
			memoTextarea.style.borderRadius = '4px';
			memoTextarea.style.fontSize = '12px';
			memoTextarea.style.fontFamily = 'inherit';
			memoTextarea.style.resize = 'vertical';
			memoTextarea.style.boxSizing = 'border-box';

			// フォーカス時のスタイル
			memoTextarea.addEventListener('focus', () => {
				memoTextarea.style.borderColor = '#e91e63';
				memoTextarea.style.outline = 'none';
			});

			memoTextarea.addEventListener('blur', () => {
				memoTextarea.style.borderColor = '#ddd';
				const newMemo = memoTextarea.value.trim();
				
				// メモが変更された場合のみ保存
				if (newMemo !== (currentMemo || '')) {
					if (newMemo) {
						saveMemoToDB(facility, newMemo);
					} else {
						deleteMemoFromDB(facility);
					}
				}
			});

			memoSection.appendChild(memoLabel);
			memoSection.appendChild(memoTextarea);
			popupContent.appendChild(memoSection);

			// カラーピッカーセクションを追加
			const colorSection = document.createElement('div');
			colorSection.style.marginTop = '12px';
			colorSection.style.display = 'flex';
			colorSection.style.alignItems = 'center';
			colorSection.style.gap = '8px';

			const colorLabel = document.createElement('label');
			colorLabel.textContent = 'ピンの色:';
			colorLabel.style.fontSize = '12px';
			colorLabel.style.fontWeight = '600';
			colorLabel.style.color = '#666';

			const colorInput = document.createElement('input');
			colorInput.type = 'color';
			const currentColor = facilityColors[facilityId] || (hasMemo ? '#e91e63' : categoryColor);
			colorInput.value = currentColor;
			colorInput.style.width = '50px';
			colorInput.style.height = '30px';
			colorInput.style.border = '1px solid #ddd';
			colorInput.style.borderRadius = '4px';
			colorInput.style.cursor = 'pointer';

			colorInput.addEventListener('change', (e) => {
				const newColor = e.target.value;
				saveColorToDB(facility, newColor);
			});

			const resetColorBtn = document.createElement('button');
			resetColorBtn.textContent = 'リセット';
			resetColorBtn.style.padding = '4px 8px';
			resetColorBtn.style.fontSize = '11px';
			resetColorBtn.style.background = '#f5f5f5';
			resetColorBtn.style.border = '1px solid #ddd';
			resetColorBtn.style.borderRadius = '4px';
			resetColorBtn.style.cursor = 'pointer';
			resetColorBtn.style.transition = 'all 0.2s';

			resetColorBtn.addEventListener('click', () => {
				deleteColorFromDB(facility);
				colorInput.value = hasMemo ? '#e91e63' : categoryColor;
			});

			resetColorBtn.addEventListener('mouseover', () => {
				resetColorBtn.style.background = '#e0e0e0';
			});

			resetColorBtn.addEventListener('mouseout', () => {
				resetColorBtn.style.background = '#f5f5f5';
			});

			colorSection.appendChild(colorLabel);
			colorSection.appendChild(colorInput);
			colorSection.appendChild(resetColorBtn);
			popupContent.appendChild(colorSection);

			return popupContent;
		}

		marker.bindPopup(updatePopupContentForPinSearch());

		// ポップアップを開く際に内容を更新
		marker.on('popupopen', () => {
			marker.setPopupContent(updatePopupContentForPinSearch());
		});

		facilityMarkers.push(marker);

		const li = document.createElement('li');
		li.className = 'facility-item' + (hasMemo ? ' has-memo' : '');
		li.dataset.facilityId = facilityId;

		let memoSection = '';
		if (hasMemo) {
			memoSection = `<div class="memo-display">${escapeHtml(facilityMemos[facilityId])}</div>`;
		}

		li.innerHTML = `
                    <div class="facility-info">
                        <div class="facility-name">${idx + 1}. ${facility.name}${hasMemo ? '<span class="facility-memo-badge">メモあり</span>' : ''}</div>
                        <div class="facility-category">${facility.category}</div>
                        <div class="facility-distance">${distance.toFixed(2)}km</div>
                        ${memoSection}
                        <div class="memo-input-container">
                            <button class="memo-btn" style="flex: 1;">メモを編集</button>
                        </div>
                    </div>
                `;

		const listMemoBtn = li.querySelector('.memo-btn');
		listMemoBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			openMemoModal(facility);
		});

		li.addEventListener('click', () => {
			map.setView([facility.latitude, facility.longitude], 16);
			highlightItem(li);
			marker.openPopup();
		});
		facilityList.appendChild(li);
	});
}

// DB操作
function saveToDB() {
	if (!db || !pinMarker) {
		alert('ピンを指してから保存してください');
		return;
	}

	// 保存名の入力ダイアログを表示
	const now = new Date();
	const defaultName = `${now.toLocaleDateString('ja-JP')} ${now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;

	const saveName = prompt('この検索に名前を付けてください:', defaultName);

	if (saveName === null) {
		// キャンセルボタンが押された
		return;
	}

	const searchData = {
		timestamp: new Date().toISOString(),
		name: saveName.trim() || defaultName,
		pin: [pinMarker.getLatLng().lat, pinMarker.getLatLng().lng],
		radius: document.getElementById('radius-input').value,
		results: pinSearchResults,
		count: pinSearchResults.length,
		memo: '' // 新しい検索のメモは初期化
	};

	const transaction = db.transaction([STORE_NAME], 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	store.add(searchData);

	transaction.oncomplete = () => {
		// 保存完了メッセージを表示
		const saveStats = document.getElementById('save-stats');
		saveStats.style.display = 'block';
		setTimeout(() => {
			saveStats.style.display = 'none';
		}, 3000);

		loadSavedData();
	};

	transaction.onerror = () => {
		alert('保存に失敗しました');
	};
}

function loadSavedData() {
	if (!db) return;

	const transaction = db.transaction([STORE_NAME], 'readonly');
	const store = transaction.objectStore(STORE_NAME);
	const request = store.getAll();

	request.onsuccess = () => {
		savedData = request.result;
		updateSavedDataUI();
	};
}

function filterAndSortData() {
	filteredSavedData = savedData.filter(data => {
		const date = new Date(data.timestamp);
		const dateStr = date.toLocaleDateString('ja-JP') + ' ' + date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
		const coordinates = data.pin.join(', ');
		const searchText = (dateStr + ' ' + data.radius + ' ' + data.count + ' ' + coordinates).toLowerCase();
		return searchText.includes(currentSearchFilter.toLowerCase());
	});

	filteredSavedData.sort((a, b) => {
		switch (currentSort) {
			case 'newest':
				return new Date(b.timestamp) - new Date(a.timestamp);
			case 'oldest':
				return new Date(a.timestamp) - new Date(b.timestamp);
			case 'radius-asc':
				return parseInt(a.radius) - parseInt(b.radius);
			case 'radius-desc':
				return parseInt(b.radius) - parseInt(a.radius);
			case 'count-asc':
				return a.count - b.count;
			case 'count-desc':
				return b.count - a.count;
			default:
				return 0;
		}
	});
}

function updateSavedDataUI() {
	const saveCount = document.getElementById('save-count');
	const saveCountSearch = document.getElementById('save-count-search');
	const dataSize = document.getElementById('data-size');
	const savedItems = document.getElementById('saved-items');

	saveCount.textContent = savedData.length;
	if (saveCountSearch) saveCountSearch.textContent = savedData.length;

	const dataJSON = JSON.stringify(savedData);
	const sizeKB = (new Blob([dataJSON]).size / 1024).toFixed(2);
	dataSize.textContent = sizeKB + ' KB';

	filterAndSortData();
	savedItems.innerHTML = '';

	if (filteredSavedData.length === 0) {
		savedItems.innerHTML = '<div class="empty-state">保存済み検索なし</div>';
		return;
	}

	filteredSavedData.forEach((data, index) => {
		const date = new Date(data.timestamp);
		const dateStr = date.toLocaleDateString('ja-JP');
		const timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
		const nurseries = data.results.filter(f => f.category === '保育園').length;
		const kindergartens = data.results.filter(f => f.category === '幼稚園').length;
		const schools = data.results.filter(f => f.category === '小学校').length;
		const displayName = data.name || `検索 #${savedData.indexOf(data) + 1}`;
		const hasMemo = data.memo && data.memo.trim() !== '';

		const item = document.createElement('div');
		item.className = 'history-item' + (hasMemo ? ' has-memo' : '');

		let memoPreview = '';
		if (hasMemo) {
			const memoText = data.memo.substring(0, 80);
			const truncated = data.memo.length > 80 ? '...' : '';
			memoPreview = `<div class="memo-preview">${escapeHtml(memoText)}${truncated}</div>`;
		}

		item.innerHTML = `
	<div class="history-card-content">
			<div class="history-card-header">
					<div class="history-card-title">
							<span class="editable-name" title="クリックして名前を編集">${displayName}</span>
							${hasMemo ? '<span class="memo-badge">📝</span>' : ''}
					</div>
					<div class="history-card-date">${dateStr} ${timeStr}</div>
			</div>
			
			<div class="history-card-stats">
					<div class="stat-group">
							<span class="stat-label">座標:</span>
							<span class="stat-value">${data.pin[0].toFixed(4)}, ${data.pin[1].toFixed(4)}</span>
					</div>
					<div class="stat-group">
							<span class="stat-label">検索範囲:</span>
							<span class="stat-value">${data.radius}km</span>
					</div>
					<div class="stat-group">
							<span class="stat-label">結果:</span>
							<span class="stat-value">保育園 ${nurseries}件 | 幼稚園 ${kindergartens}件 | 小学校 ${schools}件</span>
					</div>
			</div>
			
			<div class="history-card-actions">
					<button class="btn-primary btn-load" title="この検索を読み込む">読み込む</button>
					<button class="btn-secondary btn-memo" title="メモを編集">メモ</button>
					<button class="btn-danger btn-delete" title="削除">削除</button>
			</div>
	</div>
`;

		const editableNameElement = item.querySelector('.editable-name');
		editableNameElement.addEventListener('click', (e) => {
			e.stopPropagation();
			openEditNameModal(data);
		});

		item.querySelector('.btn-load').addEventListener('click', () => {
			if (data.pin) {
				// 保存された情報を渡す
				const savedInfo = {
					id: data.id,
					name: data.name || `検索 #${savedData.indexOf(data) + 1}`,
					memo: data.memo || '',
					timestamp: data.timestamp,
					radius: data.radius,
					count: data.count
				};
				pinPoint(data.pin[0], data.pin[1], savedInfo);
				// 地図をピンの位置にズームして飛ぶ
				setTimeout(() => {
					map.setView([data.pin[0], data.pin[1]], 13);
				}, 100);
			}
			document.querySelector('.tab[data-tab="search"]').click();
		});

		const memoBtn = item.querySelector('.btn-memo');
		if (memoBtn) {
			memoBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				openSavedSearchMemoModal(data);
			});
		}

		item.querySelector('.btn-delete').addEventListener('click', (e) => {
			e.stopPropagation();
			if (confirm('この検索を削除しますか？')) {
				deleteSavedItem(data.id);
			}
		});

		savedItems.appendChild(item);
	});
}

function deleteSavedItem(id) {
	const transaction = db.transaction([STORE_NAME], 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	store.delete(id);

	transaction.oncomplete = () => {
		loadSavedData();
	};
}

function clearDB() {
	if (!db || confirm('すべての保存済み検索を削除しますか？\nこの操作は取り消せません。')) {
		const transaction = db.transaction([STORE_NAME], 'readwrite');
		const store = transaction.objectStore(STORE_NAME);
		store.clear();

		transaction.oncomplete = () => {
			savedData = [];
			updateSavedDataUI();
			alert('すべての保存データを削除しました');
		};
	}
}

// ファイルエクスポート機能
function exportToFile() {
	if (savedData.length === 0) {
		alert('保存済み検索がありません');
		return;
	}

	const dataToExport = {
		exportDate: new Date().toISOString(),
		version: 4,
		searches: savedData.map(item => ({
			timestamp: item.timestamp,
			name: item.name || '',
			pin: item.pin,
			radius: item.radius,
			count: item.count,
			results: item.results,
			memo: item.memo || ''
		})),
		memos: Object.entries(facilityMemos).map(([facilityId, memo]) => ({
			facilityId: facilityId,
			memo: memo
		})),
		colors: Object.entries(facilityColors).map(([facilityId, color]) => ({
			facilityId: facilityId,
			color: color
		}))
	};

	const dataStr = JSON.stringify(dataToExport, null, 2);
	const blob = new Blob([dataStr], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `facilities-map-${new Date().toISOString().slice(0, 10)}.json`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);

	alert(`${savedData.length}件の検索データをファイルに保存しました`);
}

// ファイルインポート機能
function importFromFile() {
	const fileInput = document.getElementById('import-file');
	fileInput.click();
}

document.getElementById('import-file').addEventListener('change', (e) => {
	const file = e.target.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = (event) => {
		try {
			const importedData = JSON.parse(event.target.result);

			// バージョン互換性チェック
			let dataArray = [];
			if (importedData.data && Array.isArray(importedData.data)) {
				// バージョン2以前のフォーマット
				dataArray = importedData.data;
			} else if (importedData.searches && Array.isArray(importedData.searches)) {
				// バージョン3以降のフォーマット
				dataArray = importedData.searches;
			} else {
				throw new Error('ファイル形式が無効です');
			}

			let importCount = 0;
			const transaction = db.transaction([STORE_NAME], 'readwrite');
			const store = transaction.objectStore(STORE_NAME);

			dataArray.forEach(item => {
				delete item.id;
				// 名前フィールドが存在しない場合はデフォルト値を設定
				if (!item.name) {
					const date = new Date(item.timestamp);
					item.name = date.toLocaleDateString('ja-JP') + ' ' + date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
				}
				store.add(item);
				importCount++;
			});

			transaction.oncomplete = () => {
				const storesNeeded = [];
				if (importedData.memos && Array.isArray(importedData.memos)) {
					storesNeeded.push(MEMO_STORE_NAME);
				}
				if (importedData.colors && Array.isArray(importedData.colors)) {
					storesNeeded.push(COLOR_STORE_NAME);
				}

				if (storesNeeded.length > 0) {
					const extraTransaction = db.transaction(storesNeeded, 'readwrite');

					// メモデータをインポート
					let memoCount = 0;
					if (importedData.memos && Array.isArray(importedData.memos)) {
						const memoStore = extraTransaction.objectStore(MEMO_STORE_NAME);
						importedData.memos.forEach(memo => {
							memoStore.put({
								facilityId: memo.facilityId,
								memo: memo.memo,
								timestamp: new Date().toISOString()
							});
							memoCount++;
						});
					}

					// 色データをインポート
					let colorCount = 0;
					if (importedData.colors && Array.isArray(importedData.colors)) {
						const colorStore = extraTransaction.objectStore(COLOR_STORE_NAME);
						importedData.colors.forEach(colorData => {
							colorStore.put({
								facilityId: colorData.facilityId,
								color: colorData.color,
								timestamp: new Date().toISOString()
							});
							colorCount++;
						});
					}

					extraTransaction.oncomplete = () => {
						loadSavedData();
						loadAllMemos();
						loadAllColors();
						const message = `${importCount}件のデータ${memoCount > 0 ? `と${memoCount}件のメモ` : ''}${colorCount > 0 ? `、${colorCount}件の色設定` : ''}をインポートしました`;
						alert(message);
					};
				} else {
					loadSavedData();
					alert(`${importCount}件のデータをインポートしました`);
				}
			};

			transaction.onerror = () => {
				alert('インポート中にエラーが発生しました');
			};
		} catch (error) {
			alert('ファイルの読み込みに失敗しました: ' + error.message);
		}
	};
	reader.readAsText(file);

	// ファイル選択をリセット
	e.target.value = '';
});

// イベントリスナー
document.getElementById('pin-btn').addEventListener('click', togglePinMode);
document.getElementById('clear-pin-btn').addEventListener('click', () => {
	if (pinMarker) map.removeLayer(pinMarker);
	if (radiusCircle) map.removeLayer(radiusCircle);
	pinMarker = null;
	radiusCircle = null;
	document.getElementById('pin-info').innerHTML = '';
	pinMode = false;
	document.getElementById('pin-btn').classList.remove('active');
	document.getElementById('map').classList.remove('pin-mode');
});

// 検索フィルターのリアルタイム反映
document.getElementById('name-search-input').addEventListener('input', applySearchFilters);
document.getElementById('category-select').addEventListener('change', applySearchFilters);
document.getElementById('prefecture-select').addEventListener('change', applySearchFilters);

// 半径スライダーのリアルタイム反映
document.getElementById('radius-input').addEventListener('input', (e) => {
	document.getElementById('radius-display').textContent = e.target.value;

	// ピンが存在する場合、円を更新
	if (pinMarker) {
		if (radiusCircle) map.removeLayer(radiusCircle);
		const pinLat = pinMarker.getLatLng().lat;
		const pinLng = pinMarker.getLatLng().lng;

		radiusCircle = L.circle([pinLat, pinLng], {
			radius: e.target.value * 1000,
			color: '#2196F3',
			weight: 2,
			fill: false,
			dashArray: '5, 5'
		}).addTo(map);

		// 検索結果を更新
		pinSearchResults = allFacilities.filter(facility => {
			const distance = calculateDistance(pinLat, pinLng, facility.latitude, facility.longitude);
			return distance <= e.target.value;
		}).sort((a, b) => {
			const distA = calculateDistance(pinLat, pinLng, a.latitude, a.longitude);
			const distB = calculateDistance(pinLat, pinLng, b.latitude, b.longitude);
			return distA - distB;
		});

		displayPinSearchResults(pinLat, pinLng);
	}
});

document.getElementById('save-btn').addEventListener('click', saveToDB);
document.getElementById('clear-db-btn').addEventListener('click', clearDB);

// ファイル操作イベント
document.getElementById('export-btn').addEventListener('click', exportToFile);
document.getElementById('import-btn').addEventListener('click', importFromFile);

// 履歴検索フィルター
document.getElementById('history-search-box').addEventListener('input', (e) => {
	currentSearchFilter = e.target.value;
	updateSavedDataUI();
});

// ソートボタン
document.querySelectorAll('.sort-btn').forEach(btn => {
	btn.addEventListener('click', () => {
		document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
		btn.classList.add('active');
		currentSort = btn.dataset.sort;
		updateSavedDataUI();
	});
});

// モーダル関連の関数
let editingDataId = null;

function openEditNameModal(data) {
	editingDataId = data.id;
	const modal = document.getElementById('edit-name-modal');
	const input = document.getElementById('edit-name-input');
	input.value = data.name || '';
	modal.classList.add('active');
	input.focus();
	input.select();
}

function closeEditNameModal() {
	const modal = document.getElementById('edit-name-modal');
	modal.classList.remove('active');
	editingDataId = null;
}

function updateNameInDB() {
	const newName = document.getElementById('edit-name-input').value.trim();

	if (!newName) {
		alert('名前を入力してください');
		return;
	}

	if (!db || editingDataId === null) {
		alert('エラーが発生しました');
		return;
	}

	const transaction = db.transaction([STORE_NAME], 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	const getRequest = store.get(editingDataId);

	getRequest.onsuccess = () => {
		const data = getRequest.result;
		if (data) {
			data.name = newName;
			const putRequest = store.put(data);

			putRequest.onsuccess = () => {
				closeEditNameModal();
				loadSavedData();
			};

			putRequest.onerror = () => {
				alert('更新に失敗しました');
			};
		}
	};

	getRequest.onerror = () => {
		alert('データの取得に失敗しました');
	};
}

// モーダルボタンのイベントリスナー
document.getElementById('modal-cancel-btn').addEventListener('click', closeEditNameModal);
document.getElementById('modal-confirm-btn').addEventListener('click', updateNameInDB);

// メモモーダルのイベントリスナー
document.getElementById('memo-cancel-btn').addEventListener('click', () => {
	if (editingSavedSearchId !== null) {
		editingSavedSearchId = null;
	}
	closeMemoModal();
});

document.getElementById('memo-save-btn').addEventListener('click', () => {
	if (editingSavedSearchId !== null) {
		saveSavedSearchMemo();
	} else if (currentEditingMemoFacility) {
		saveMemo();
	}
});

// メモモーダルのテキストエリアでEnterを押して保存
document.getElementById('memo-input').addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && e.ctrlKey) {
		if (editingSavedSearchId !== null) {
			saveSavedSearchMemo();
		} else if (currentEditingMemoFacility) {
			saveMemo();
		}
	}
});

// メモモーダルの外側をクリックで閉じる
document.getElementById('memo-modal').addEventListener('click', (e) => {
	if (e.target.id === 'memo-modal') {
		if (editingSavedSearchId !== null) {
			editingSavedSearchId = null;
		}
		closeMemoModal();
	}
});

// Enterキーで更新、Escキーでキャンセル
document.getElementById('edit-name-input').addEventListener('keypress', (e) => {
	if (e.key === 'Enter') {
		updateNameInDB();
	}
});

document.getElementById('edit-name-input').addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		closeEditNameModal();
	}
});

// モーダルの外側をクリックで閉じる
document.getElementById('edit-name-modal').addEventListener('click', (e) => {
	if (e.target.id === 'edit-name-modal') {
		closeEditNameModal();
	}
});

// 初期化
async function initialize() {
	initTabs();
	initMap();
	await loadFacilities();
	await initIndexedDB();
}

initialize();