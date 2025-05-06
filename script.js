const corsProxy = 'https://cors-anywhere.herokuapp.com/';
const baseUrl = 'https://lainchan.org';
const fallbackProxy = 'https://api.allorigins.win/raw?url=';
const maxRetries = 3;
const requestTimeout = 10000; // 10 seconds
const cacheTTL = 5 * 60 * 1000; // 5 minutes

// Header Scroll Behavior
let lastScrollTop = 0;
window.addEventListener('scroll', () => {
    const header = document.querySelector('.header');
    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
    if (currentScroll > lastScrollTop && currentScroll > 100) {
        header.classList.add('hidden');
    } else {
        header.classList.remove('hidden');
    }
    lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;
});

// Image Preview (Cursor-Following)
function setupImagePreviews() {
    const images = document.querySelectorAll('.messages .message img');
    const preview = document.createElement('div');
    preview.className = 'image-preview';
    document.body.appendChild(preview);

    images.forEach(img => {
        img.addEventListener('mouseenter', () => {
            preview.innerHTML = `<img src="${img.src}" alt="Preview">`;
            preview.style.display = 'block';
        });
        img.addEventListener('mousemove', (e) => {
            const imgRect = preview.getBoundingClientRect();
            let left = e.clientX + 10;
            let top = e.clientY + 10;
            if (left + imgRect.width > window.innerWidth) {
                left = window.innerWidth - imgRect.width - 10;
            }
            if (top + imgRect.height > window.innerHeight) {
                top = window.innerHeight - imgRect.height - 10;
            }
            preview.style.left = `${Math.max(10, left)}px`;
            preview.style.top = `${Math.max(10, top)}px`;
        });
        img.addEventListener('mouseleave', () => {
            preview.style.display = 'none';
        });
        img.addEventListener('click', () => {
            const modal = new bootstrap.Modal(document.getElementById('imageModal'));
            document.getElementById('modalImage').src = img.src;
            modal.show();
        });
    });
}

// Cache Handling
function getCachedData(key) {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > cacheTTL) {
        localStorage.removeItem(key);
        return null;
    }
    return data;
}

function setCachedData(key, data) {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
}

// Fetch with Timeout and Retry
async function fetchWithRetry(url, retries = maxRetries, useFallback = false) {
    const proxy = useFallback ? fallbackProxy : corsProxy;
    const cacheKey = `lainchan_${url}`;
    const loadingScreen = document.getElementById('loadingScreen');
    loadingScreen.style.display = 'flex';

    // Check cache
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
        console.log(`Using cached data for ${url}`);
        loadingScreen.style.display = 'none';
        return cachedData;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

    try {
        const response = await fetch(proxy + url, {
            signal: controller.signal,
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': window.location.origin,
                'Accept': 'application/json',
            },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText || 'Unknown error'}`);
        }

        const data = await response.json();
        if (!data || (Array.isArray(data) && data.length === 0)) {
            throw new Error('Empty or invalid response');
        }

        setCachedData(cacheKey, data);
        return data;
    } catch (error) {
        clearTimeout(timeoutId);
        console.error(`Fetch error for ${url}: ${error.message}, Proxy: ${proxy}, Retries left: ${retries}`);
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay
            return fetchWithRetry(url, retries - 1, !useFallback);
        }
        throw error;
    } finally {
        loadingScreen.style.display = 'none';
    }
}

async function loadThreads() {
    const board = document.getElementById('boardSelect').value;
    if (!board) return;
    const postsContainer = document.getElementById('postsContainer');
    const threadView = document.getElementById('threadView');
    postsContainer.classList.remove('d-none');
    threadView.classList.add('d-none');
    postsContainer.innerHTML = '<p>Loading...</p>';

    const retryButton = document.createElement('button');
    retryButton.className = 'btn-retry';
    retryButton.textContent = 'Retry';
    retryButton.onclick = () => {
        retryButton.classList.add('loading');
        loadThreads().finally(() => retryButton.classList.remove('loading'));
    };

    const debugButton = document.createElement('button');
    debugButton.className = 'btn-retry';
    debugButton.textContent = 'Show Debug Info';
    debugButton.onclick = () => {
        const debugInfo = `
            URL: ${baseUrl}/${board}/catalog.json\n
            Primary Proxy: ${corsProxy}\n
            Fallback Proxy: ${fallbackProxy}\n
            Last Error: ${postsContainer.dataset.lastError || 'Unknown'}\n
            Timestamp: ${new Date().toISOString()}
        `;
        alert(debugInfo);
    };

    try {
        const data = await fetchWithRetry(`${baseUrl}/${board}/catalog.json`);
        postsContainer.innerHTML = '';
        data.forEach(page => {
            page.threads.forEach(thread => {
                const card = document.createElement('div');
                card.className = 'col-md-4 mb-4';
                card.innerHTML = `
                    <div class="card" onclick="loadThreadDetails('${board}', ${thread.no})">
                        ${thread.tim ? `
                            <img src="${baseUrl}/${board}/src/${thread.tim}${thread.ext}" class="card-img-top" alt="Thread image">
                        ` : ''}
                        <div class="card-body">
                            <h5 class="card-title">${thread.sub || 'No Subject'}</h5>
                            <p class="card-text">${truncateComment(thread.com || '', 100)}</p>
                            <p class="text-muted">Post #${thread.no} | Replies: ${thread.replies}</p>
                        </div>
                    </div>
                `;
                postsContainer.appendChild(card);
            });
        });
    } catch (error) {
        postsContainer.dataset.lastError = error.message;
        postsContainer.innerHTML = `
            <p class="error-message">Error: Failed to load threads (${error.message}). The CORS proxy may be down or require access. Visit <a href="https://cors-anywhere.herokuapp.com" target="_blank">cors-anywhere.herokuapp.com</a> to request temporary access, then try again. ${fallbackProxy ? '(Tried fallback proxy)' : ''}</p>
        `;
        postsContainer.appendChild(retryButton);
        postsContainer.appendChild(debugButton);
    }
}

async function loadThreadDetails(board, threadNo) {
    const postsContainer = document.getElementById('postsContainer');
    const threadView = document.getElementById('threadView');
    const threadMessages = document.getElementById('threadMessages');
    const threadTitle = document.getElementById('threadTitle');

    postsContainer.classList.add('d-none');
    threadView.classList.remove('d-none');
    threadMessages.innerHTML = '<p>Loading...</p>';

    const retryButton = document.createElement('button');
    retryButton.className = 'btn-retry';
    retryButton.textContent = 'Retry';
    retryButton.onclick = () => {
        retryButton.classList.add('loading');
        loadThreadDetails(board, threadNo).finally(() => retryButton.classList.remove('loading'));
    };

    const debugButton = document.createElement('button');
    debugButton.className = 'btn-retry';
    debugButton.textContent = 'Show Debug Info';
    debugButton.onclick = () => {
        const debugInfo = `
            URL: ${baseUrl}/${board}/res/${threadNo}.json\n
            Primary Proxy: ${corsProxy}\n
            Fallback Proxy: ${fallbackProxy}\n
            Last Error: ${threadMessages.dataset.lastError || 'Unknown'}\n
            Timestamp: ${new Date().toISOString()}
        `;
        alert(debugInfo);
    };

    try {
        const threadData = await fetchWithRetry(`${baseUrl}/${board}/res/${threadNo}.json`);
        const op = threadData.posts[0];
        threadTitle.textContent = op.sub || `Thread #${threadNo}`;
        threadMessages.innerHTML = '';

        threadData.posts.forEach((post, index) => {
            threadMessages.appendChild(createMessage(post, board, index === 0));
        });

        threadMessages.scrollTop = 0;
        setupImagePreviews();
    } catch (error) {
        threadMessages.dataset.lastError = error.message;
        threadMessages.innerHTML = `
            <p class="error-message">Error: Failed to load thread (${error.message}). The CORS proxy may be down or require access. Visit <a href="https://cors-anywhere.herokuapp.com" target="_blank">cors-anywhere.herokuapp.com</a> to request temporary access, then try again. ${fallbackProxy ? '(Tried fallback proxy)' : ''}</p>
        `;
        threadMessages.appendChild(retryButton);
        threadMessages.appendChild(debugButton);
    }
}

function createMessage(post, board, isOP) {
    const messageContainer = document.createElement('div');
    messageContainer.className = `message-container ${isOP ? 'yours' : 'mine'}`;
    messageContainer.id = `post-${post.no}`;

    const message = document.createElement('div');
    message.className = 'message';

    let comment = DOMPurify.sanitize(post.com || 'No comment');
    comment = comment.replace(/^>.*$/gm, match => `<span class="greentext">${match}</span>`);
    comment = comment.replace(/>>([0-9]+)/g, (match, postNo) => {
        return `<span class="reply-link" onclick="scrollToPost(${postNo})">>>${postNo}</span>`;
    });

    message.innerHTML = `
        ${post.tim ? `
            <img src="${baseUrl}/${board}/src/${post.tim}${post.ext}" alt="Post image" aria-label="Click to view full-size image">
        ` : ''}
        <p>${comment}</p>
        <p class="post-no">Post #${post.no}</p>
    `;

    messageContainer.appendChild(message);
    return messageContainer;
}

function scrollToPost(postNo) {
    const postElement = document.getElementById(`post-${postNo}`);
    if (postElement) {
        postElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        postElement.classList.add('highlight');
        setTimeout(() => postElement.classList.remove('highlight'), 1000);
    }
}

function goBackToThreads() {
    const postsContainer = document.getElementById('postsContainer');
    const threadView = document.getElementById('threadView');
    postsContainer.classList.remove('d-none');
    threadView.classList.add('d-none');
}

function truncateComment(comment, maxLength) {
    if (comment.length <= maxLength) return comment;
    return comment.substring(0, maxLength) + '...';
}

// Load threads on page load if a board is pre-selected
if (document.getElementById('boardSelect').value) {
    loadThreads();
}
