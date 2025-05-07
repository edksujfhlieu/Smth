// Service Worker для перехвата и анализа сетевых запросов
let isLogging = true; // Начинаем с активного логирования по умолчанию
const TRACKED_DOMAINS = ['gifts2.tonnel.network']; // Домены, которые нужно отслеживать специально

// Кэш для хранения логов, когда основное приложение не активно
let cachedLogs = [];
const MAX_CACHED_LOGS = 100;

// Активация Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker активирован');
  // Захватить управление всеми клиентами без ожидания обновления страницы
  event.waitUntil(clients.claim());
});

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker установлен');
  // Перейти к активации, не дожидаясь закрытия старых вкладок
  self.skipWaiting();
});

// Обработка сообщений от основного скрипта
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'START_LOGGING') {
    isLogging = true;
    console.log('Логирование запросов запущено');
    
    // Отправляем клиенту кэшированные логи, если они есть
    if (cachedLogs.length > 0) {
      sendCachedLogsToClient(event.source);
    }
  } else if (event.data && event.data.type === 'STOP_LOGGING') {
    isLogging = false;
    console.log('Логирование запросов остановлено');
  } else if (event.data && event.data.type === 'REQUEST_CACHED_LOGS') {
    // Клиент запрашивает кэшированные логи после переподключения
    sendCachedLogsToClient(event.source);
  }
});

// Отправка кэшированных логов конкретному клиенту
function sendCachedLogsToClient(client) {
  if (cachedLogs.length > 0) {
    client.postMessage({
      type: 'CACHED_LOGS',
      logs: cachedLogs
    });
    console.log(`Отправлено ${cachedLogs.length} кэшированных логов клиенту`);
    // Очищаем кэш после отправки
    cachedLogs = [];
  }
}

// Отправка логов в основное приложение
async function sendLogToClient(logData) {
  try {
    const allClients = await clients.matchAll({
      includeUncontrolled: true,
      type: 'window'
    });

    // Если есть активные клиенты, отправляем логи
    if (allClients.length > 0) {
      allClients.forEach(client => {
        client.postMessage({
          type: 'REQUEST_LOG',
          log: logData
        });
      });
    } else {
      // Если клиентов нет (приложение в фоне), кэшируем логи
      cachedLogs.push(logData);
      // Ограничиваем размер кэша
      if (cachedLogs.length > MAX_CACHED_LOGS) {
        cachedLogs.shift(); // Удаляем самый старый лог
      }
    }
  } catch (error) {
    console.error('Ошибка отправки логов клиенту:', error);
    // В случае ошибки, сохраняем в кэш
    cachedLogs.push(logData);
  }
}

// Извлечение payload из различных типов запросов
async function extractPayload(request) {
  try {
    const clonedRequest = request.clone();
    
    // Проверяем тип контента
    const contentType = request.headers.get('Content-Type') || '';
    
    if (contentType.includes('application/json')) {
      return await clonedRequest.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      try {
        const formData = await clonedRequest.formData();
        const formDataObj = {};
        for (const [key, value] of formData.entries()) {
          formDataObj[key] = value;
        }
        return formDataObj;
      } catch (e) {
        // Если не удалось получить как formData, пробуем как текст
        return await clonedRequest.clone().text();
      }
    } else if (contentType.includes('multipart/form-data')) {
      return 'Multipart form data - невозможно отобразить полное содержимое';
    } else if (contentType.includes('text/')) {
      return await clonedRequest.text();
    } else {
      try {
        // Попытка получить тело как текст
        return await clonedRequest.text();
      } catch (e) {
        return 'Неподдерживаемый тип контента';
      }
    }
  } catch (error) {
    console.error('Ошибка при извлечении payload:', error);
    try {
      // Последняя попытка получить данные в виде текста
      return await request.clone().text();
    } catch (e) {
      return 'Ошибка при извлечении payload';
    }
  }
}

// Проверяем, нужно ли отслеживать запрос
function shouldTrackRequest(url) {
  // Игнорируем запросы к самому Service Worker
  if (url.includes('sw.js')) return false;
  
  // Игнорируем запросы к Google Analytics и другим трекинговым сервисам
  if (url.includes('google-analytics.com') || url.includes('analytics') || 
      url.includes('stat') || url.includes('metric')) return false;
  
  // Всегда отслеживаем запросы к указанным доменам
  for (const domain of TRACKED_DOMAINS) {
    if (url.includes(domain)) {
      return true;
    }
  }
  
  // Если мы в режиме отслеживания всех запросов
  return isLogging;
}

// Перехват запросов
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = request.url;
  
  // Проверяем, нужно ли отслеживать этот запрос
  if (!shouldTrackRequest(url)) return;
  
  // Используем respondWith, только если нужно отследить запрос
  event.respondWith(
    (async () => {
      // Собираем информацию о заголовках
      const headers = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      
      // Пытаемся извлечь payload для соответствующих типов запросов
      let payload = null;
      try {
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          payload = await extractPayload(request);
        }
      } catch (e) {
        console.error('Ошибка при извлечении payload:', e);
      }
      
      // Логируем информацию
      const logData = {
        url: request.url,
        method: request.method,
        headers: headers,
        payload: payload,
        timestamp: new Date().toISOString()
      };
      
      // Отправляем лог клиенту
      sendLogToClient(logData);
      
      // Продолжаем обработку запроса как обычно
      try {
        return await fetch(request.clone());
      } catch (error) {
        console.error('Ошибка при выполнении запроса:', error);
        throw error;
      }
    })()
  );
}); 
