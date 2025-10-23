// popup.js

class LinkedInScraperPopup {
  constructor() {
    this.data = {
      myConnections: [],
      totalExtracted: 0
    };

    // Queue state from background
    this.queue = {
      items: [],
      currentIndex: 0,
      isRunning: false,
      breakEndTime: null
    };

    this.automation = {
      isRunning: false,
      status: 'Ready'
    };

    this.busy = {
      dataOperation: false,
      queueOperation: false
    };

    this.settings = {
      showNotifications: true,
      queueExpanded: false
    };

    this.fixedFileName = 'linkedin_connections.csv';
    this.breakTimerInterval = null; // For UI updates only
    
    this.init();
  }

  async init() {
    this.initializeElements();
    this.initializeModalElements(); 
    this.bindEvents();
    this.bindModalEvents(); 
    this.setupDragAndDrop();
    
    try {
      await this.loadAllData();
      await this.loadSettings();
      await this.loadQueueStatus();
      this.checkCurrentPage();
      this.startMonitoring();
      this.updateAllUI();
      console.log('Popup initialized successfully');
    } catch (error) {
      console.error('Popup initialization failed:', error);
      this.setStatus('error', 'Failed to initialize');
    }
  }

  initializeElements() {
    this.elements = {
      // Status and stats
      status: document.getElementById('status'),
      connectionsCount: document.getElementById('connectionsCount'),
      extractedCount: document.getElementById('extractedCount'),
      fileInfo: document.getElementById('fileInfo'),
      
      // Manual controls
      grabMyConnections: document.getElementById('grabMyConnections'),
      grab2ndConnections: document.getElementById('grab2ndConnections'),
      
      // Queue system
      expandQueue: document.getElementById('expandQueue'),
      queueInputSection: document.getElementById('queueInputSection'),
      urlQueue: document.getElementById('urlQueue'),
      queueStatus: document.getElementById('queueStatus'),
      queueProgress: document.getElementById('queueProgress'),
      breakTimer: document.getElementById('breakTimer'),
      breakTimeLeft: document.getElementById('breakTimeLeft'),
      skipBreak: document.getElementById('skipBreak'),
      breakMinutesInput: document.getElementById('breakMinutesInput'),
      setBreakTime: document.getElementById('setBreakTime'),
      startQueueAutomation: document.getElementById('startQueueAutomation'),
      resumeQueue: document.getElementById('resumeQueue'),
      clearQueue: document.getElementById('clearQueue'),
      queueList: document.getElementById('queueList'),
      queueItems: document.getElementById('queueItems'),
      collapseQueue: document.getElementById('collapseQueue'),
      
      // Single page automation
      startAutomation: document.getElementById('startAutomation'),
      
      // Settings
      showNotifications: document.getElementById('showNotifications'),
      
      // Utility controls
      exportData: document.getElementById('exportData'),
      pushToDatabase: document.getElementById('pushToDatabase'),
      debugPage: document.getElementById('debugPage'),
      clearMemory: document.getElementById('clearMemory'),
      clearData: document.getElementById('clearData')
    };

    const missingElements = [];
    for (const [name, element] of Object.entries(this.elements)) {
      if (!element) {
        missingElements.push(name);
      }
    }

    if (missingElements.length > 0) {
      console.error('Missing DOM elements:', missingElements);
    }
  }

  bindEvents() {
    // Manual controls
    this.elements.grabMyConnections.addEventListener('click', () => this.grabMyConnections());
    this.elements.grab2ndConnections.addEventListener('click', () => this.grab2ndConnections());
    
    // Queue system - UPDATED to communicate with background
    this.elements.expandQueue.addEventListener('click', () => this.toggleQueueExpansion());
    this.elements.startQueueAutomation.addEventListener('click', () => this.toggleQueueAutomation());
    if (this.elements.resumeQueue) {
      this.elements.resumeQueue.addEventListener('click', () => this.resumeQueue());
    }
    this.elements.clearQueue.addEventListener('click', () => this.clearQueue());
    this.elements.collapseQueue.addEventListener('click', () => this.toggleQueueList());
    this.elements.skipBreak.addEventListener('click', () => this.skipBreak());
    this.elements.setBreakTime.addEventListener('click', () => this.setBreakTime());
    this.elements.breakMinutesInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.setBreakTime();
    });
    
    // Single page automation
    this.elements.startAutomation.addEventListener('click', () => this.toggleSinglePageAutomation());
    
    // Settings
    this.elements.showNotifications.addEventListener('change', () => this.saveSettings());
    
    // Utility controls
    this.elements.exportData.addEventListener('click', () => this.exportToCSV());
    this.elements.pushToDatabase.addEventListener('click', () => this.pushDataToDatabase());
    this.elements.debugPage.addEventListener('click', () => this.debugCurrentPage());
    this.elements.clearMemory.addEventListener('click', () => this.clearMemoryOnly());
    this.elements.clearData.addEventListener('click', () => this.clearAllData());
  }

  // =============================================
  // SINGLE PAGE AUTOMATION - MODIFIED
  // =============================================

  async toggleSinglePageAutomation() {
    if (this.automation.isRunning) {
      await this.stopSinglePageAutomation();
    } else {
      await this.startSinglePageAutomation();
    }
  }

  async startSinglePageAutomation() {
    try {
      // MODIFIED: Send message to the background script, not the tab directly
      const response = await this.chromeAPI(() => chrome.runtime.sendMessage({ action: 'startSinglePageAutomation' }));
      
      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to start automation');
      }
      
      this.automation.isRunning = true;
      this.automation.status = 'Running';
      this.updateAllUI();
      this.setStatus('working', 'Single-page automation started');
      
    } catch (error) {
      this.setStatus('error', `Failed to start automation: ${error.message}`);
    }
  }

  async stopSinglePageAutomation() {
    try {
      // MODIFIED: Send message to the background script
      await this.chromeAPI(() => chrome.runtime.sendMessage({ action: 'stopSinglePageAutomation' }));
      
      this.automation.isRunning = false;
      this.automation.status = 'Ready';
      this.updateAllUI();
      this.setStatus('ready', 'Single-page automation stopped');
      
    } catch (error) {
      // This part is for UI cleanup, so it can stay mostly the same
      this.automation.isRunning = false;
      this.automation.status = 'Ready';
      this.updateAllUI();
    }
  }
    
  // =============================================
  // QUEUE CONTROL METHODS - DELEGATE TO BACKGROUND
  // =============================================

  async loadQueueStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getQueueStatus' });
      if (response && response.success) {
        this.queue = response.queue;
        
        if (this.queue.breakEndTime && this.queue.breakEndTime > Date.now()) {
          this.startBreakDisplayTimer();
        }
        
        console.log(`Loaded queue status: ${this.queue.items.length} items, running: ${this.queue.isRunning}`);
      }
    } catch (error) {
      console.error('Error loading queue status:', error);
    }
  }

  async toggleQueueAutomation() {
    if (this.queue.isRunning) {
      await this.stopQueue();
    } else {
      await this.startQueue();
    }
  }

  async startQueue() {
    if (this.busy.queueOperation) {
      console.log('Queue operation already in progress');
      return;
    }
    
    this.busy.queueOperation = true;
    
    try {
      const urlText = this.elements.urlQueue.value.trim();
      let queueItems = [...this.queue.items];
      
      if (urlText) {
        const newUrls = this.parseUrls(urlText);
        if (newUrls.length === 0) {
          this.setStatus('error', 'No valid LinkedIn URLs found');
          return;
        }
        
        const existingUrls = new Set(queueItems.map(item => item.url));
        const uniqueUrls = newUrls.filter(item => !existingUrls.has(item.url));
        
        if (uniqueUrls.length === 0) {
          this.setStatus('error', 'All URLs already in queue');
          return;
        }
        
        queueItems.push(...uniqueUrls);
        this.elements.urlQueue.value = '';
      }
      
      if (queueItems.length === 0) {
        this.setStatus('error', 'Please enter URLs to process');
        return;
      }
      
      const response = await chrome.runtime.sendMessage({
        action: 'startQueue',
        queueItems: queueItems
      });
      
      if (response && response.success) {
        this.setStatus('working', `Queue started (${queueItems.length} URLs)`);
        await this.loadQueueStatus();
        this.updateAllUI();
      } else {
        throw new Error(response?.error || 'Failed to start queue');
      }
      
    } catch (error) {
      console.error('Error starting queue:', error);
      this.setStatus('error', 'Failed to start queue');
    } finally {
      this.busy.queueOperation = false;
    }
  }

  async stopQueue() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'stopQueue' });
      if (response && response.success) {
        this.setStatus('ready', 'Queue stopped');
        this.stopBreakDisplayTimer();
        await this.loadQueueStatus();
        this.updateAllUI();
      } else {
        throw new Error(response?.error || 'Failed to stop queue');
      }
    } catch (error) {
      console.error('Error stopping queue:', error);
    }
  }

  async skipBreak() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'skipBreak' });
      if (response && response.success) {
        this.stopBreakDisplayTimer();
        this.elements.breakTimer.style.display = 'none';
        this.setStatus('working', 'Break skipped - resuming queue');
      }
    } catch (error) {
      console.error('Error skipping break:', error);
    }
  }

  async setBreakTime() {
    const minutes = parseInt(this.elements.breakMinutesInput.value);
    if (isNaN(minutes) || minutes < 1) return;
    
    try {
      const endTime = Date.now() + (minutes * 60 * 1000);
      const response = await chrome.runtime.sendMessage({
        action: 'setBreakEndTime',
        endTime: endTime
      });
      
      if (response && response.success) {
        console.log(`Break timer updated to ${minutes} minutes`);
        this.queue.breakEndTime = endTime;
        this.startBreakDisplayTimer();
      }
    } catch (error) {
      console.error('Error updating break time:', error);
    }
  }

  async resumeQueue() {
    await this.startQueue();
  }

  async clearQueue() {
    if (this.queue.items.length === 0) return;
    
    if (!confirm('Clear the entire queue? This will stop any running automation.')) {
      return;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'clearQueue' });
      
      if (response && response.success) {
        this.queue.items = [];
        this.queue.currentIndex = 0;
        this.queue.breakEndTime = null;
        this.elements.urlQueue.value = '';
        
        this.stopBreakDisplayTimer();
        this.elements.breakTimer.style.display = 'none';
        
        this.updateAllUI();
        this.setStatus('ready', 'Queue cleared');
        console.log('Queue successfully cleared');
      } else {
        throw new Error(response?.error || 'Failed to clear queue');
      }
    } catch (error) {
      console.error('Error clearing queue:', error);
      this.setStatus('error', `Failed to clear queue: ${error.message}`);
    }
  }


  renderQueueList() {
    if (this.queue.items.length === 0) {
      this.elements.queueList.style.display = 'none';
      return;
    }
    
    this.elements.queueList.style.display = 'block';
    this.elements.queueItems.innerHTML = '';
    
    this.queue.items.forEach((item, index) => {
      const queueItem = document.createElement('div');
      queueItem.className = `queue-item ${item.status}`;
      queueItem.dataset.index = index;
      
      queueItem.draggable = true;
      queueItem.addEventListener('dragstart', this.handleDragStart.bind(this));
      queueItem.addEventListener('dragend', this.handleDragEnd.bind(this));
      
      queueItem.addEventListener('click', (e) => {
        if (e.defaultPrevented) return;
        this.openModal(index);
      });

      queueItem.addEventListener('dragstart', (e) => {
        e.preventDefault = true;
      });
      
      const dragHandle = document.createElement('div');
      dragHandle.className = 'drag-handle';
      dragHandle.innerHTML = '⋮⋮';
      dragHandle.title = 'Drag to reorder';
      
      dragHandle.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      
      queueItem.appendChild(dragHandle);
      
      const status = document.createElement('div');
      status.className = `queue-item-status ${item.status}`;
      
      const url = document.createElement('div');
      url.className = 'queue-item-url';
      url.textContent = item.sourceName || 'Queued';
      url.title = `Click to manage this item\n${item.url}`;
      
      if (index === this.queue.currentIndex && this.queue.isRunning) {
        queueItem.style.borderLeft = '3px solid #fbbf24';
        queueItem.style.background = 'rgba(251, 191, 36, 0.1)';
      }
      
      if (item.profilesFound > 0) {
        const count = document.createElement('div');
        count.className = 'queue-item-count';
        count.textContent = `${item.profilesFound} profiles`;
        queueItem.appendChild(count);
      }
      
      queueItem.appendChild(status);
      queueItem.appendChild(url);
      
      this.elements.queueItems.appendChild(queueItem);
    });
  }

  // =============================================
  // DRAG AND DROP QUEUE REORDERING
  // =============================================

  setupDragAndDrop() {
    this.elements.queueItems.addEventListener('dragover', this.handleDragOver.bind(this));
    this.elements.queueItems.addEventListener('drop', this.handleDrop.bind(this));
  }

  handleDragStart(e) {
    const queueItem = e.currentTarget;
    const index = parseInt(queueItem.dataset.index);
    
    this.draggedIndex = index;
    queueItem.classList.add('dragging');
    
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
    
    console.log(`Started dragging item ${index}`);
  }

  handleDragEnd(e) {
    const queueItem = e.currentTarget;
    queueItem.classList.remove('dragging');
    
    document.querySelectorAll('.queue-item.drag-over').forEach(item => {
      item.classList.remove('drag-over');
    });
    
    this.draggedIndex = null;
  }

  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const queueItem = e.target.closest('.queue-item');
    if (!queueItem || this.draggedIndex === null) return;
    
    const targetIndex = parseInt(queueItem.dataset.index);
    
    document.querySelectorAll('.queue-item.drag-over').forEach(item => {
      item.classList.remove('drag-over');
    });
    
    if (targetIndex !== this.draggedIndex) {
      queueItem.classList.add('drag-over');
    }
  }

  handleDrop(e) {
    e.preventDefault();
    
    if (this.draggedIndex === null) return;
    
    const queueItem = e.target.closest('.queue-item');
    if (!queueItem) return;
    
    const targetIndex = parseInt(queueItem.dataset.index);
    
    document.querySelectorAll('.queue-item.drag-over').forEach(item => {
      item.classList.remove('drag-over');
    });
    
    if (targetIndex === this.draggedIndex) return;
    
    console.log(`Dropping item ${this.draggedIndex} onto position ${targetIndex}`);
    
    this.reorderQueueItems(this.draggedIndex, targetIndex);
  }

  async reorderQueueItems(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    
    try {
      const newItems = [...this.queue.items];
      const draggedItem = newItems.splice(fromIndex, 1)[0];
      newItems.splice(toIndex, 0, draggedItem);
      
      console.log(`Reordering: moving item from position ${fromIndex} to ${toIndex}`);
      
      this.queue.items = newItems;
      
      if (this.queue.isRunning) {
        if (fromIndex === this.queue.currentIndex) {
          this.queue.currentIndex = toIndex;
        } else if (fromIndex < this.queue.currentIndex && toIndex >= this.queue.currentIndex) {
          this.queue.currentIndex--;
        } else if (fromIndex > this.queue.currentIndex && toIndex <= this.queue.currentIndex) {
          this.queue.currentIndex++;
        }
      }
      
      const response = await chrome.runtime.sendMessage({
        action: 'reorderQueue',
        newItems: newItems,
        newCurrentIndex: this.queue.currentIndex
      });
      
      if (response && response.success) {
        this.renderQueueList();
        console.log(`Queue reordered successfully`);
      } else {
        console.error('Failed to reorder queue in background script');
        await this.loadQueueStatus();
        this.renderQueueList();
      }
      
    } catch (error) {
      console.error('Error reordering queue:', error);
      await this.loadQueueStatus();
      this.renderQueueList();
    }
  }

  
// =============================================
  // MODAL FUNCTIONALITY 
  // =============================================

  initializeModalElements() {
    this.modalElements = {
      modal: document.getElementById('queueItemModal'),
      modalTitle: document.getElementById('modalTitle'),
      modalItemName: document.getElementById('modalItemName'),
      modalItemUrl: document.getElementById('modalItemUrl'),
      modalItemStatus: document.getElementById('modalItemStatus'),
      closeModal: document.getElementById('closeModal'),
      jumpToItem: document.getElementById('jumpToItem'),
      deleteItem: document.getElementById('deleteItem')
    };
  }

  bindModalEvents() {
    this.modalElements.closeModal.addEventListener('click', () => this.closeModal());
    this.modalElements.modal.addEventListener('click', (e) => {
      if (e.target === this.modalElements.modal) {
        this.closeModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modalElements.modal.style.display !== 'none') {
        this.closeModal();
      }
    });

    this.modalElements.jumpToItem.addEventListener('click', () => this.jumpToQueueItem());
    this.modalElements.deleteItem.addEventListener('click', () => this.deleteQueueItem());
  }

  openModal(itemIndex) {
    const item = this.queue.items[itemIndex];
    if (!item) return;

    this.selectedItemIndex = itemIndex;
    
    this.modalElements.modalItemName.textContent = item.sourceName || 'Unknown';
    this.modalElements.modalItemUrl.textContent = item.url;
    this.modalElements.modalItemStatus.textContent = `Status: ${this.formatStatus(item.status)}`;
    this.modalElements.modalItemStatus.className = `modal-item-status ${item.status}`;

    this.updateModalButtons(item, itemIndex);

    this.modalElements.modal.style.display = 'flex';
  }

  closeModal() {
    this.modalElements.modal.style.display = 'none';
    this.selectedItemIndex = null;
  }

  formatStatus(status) {
    switch (status) {
      case 'pending': return 'Pending';
      case 'processing': return 'Currently Processing';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      default: return status;
    }
  }

  updateModalButtons(item, itemIndex) {
    const isCurrentlyProcessing = this.queue.isRunning && itemIndex === this.queue.currentIndex;
    const isAlreadyCompleted = item.status === 'completed';
    const isQueueRunning = this.queue.isRunning;

    if (isCurrentlyProcessing) {
      this.modalElements.jumpToItem.textContent = 'Currently Processing';
      this.modalElements.jumpToItem.disabled = true;
    } else if (isAlreadyCompleted) {
      this.modalElements.jumpToItem.textContent = 'Re-scrape This Item';
      this.modalElements.jumpToItem.disabled = false;
    } else if (isQueueRunning) {
      this.modalElements.jumpToItem.textContent = 'Jump To This Item';
      this.modalElements.jumpToItem.disabled = false;
    } else {
      this.modalElements.jumpToItem.textContent = 'Start From This Item';
      this.modalElements.jumpToItem.disabled = false;
    }

    if (isCurrentlyProcessing) {
      this.modalElements.deleteItem.textContent = 'Cannot Delete (Processing)';
      this.modalElements.deleteItem.disabled = true;
    } else {
      this.modalElements.deleteItem.textContent = 'Remove From Queue';
      this.modalElements.deleteItem.disabled = false;
    }
  }

  async jumpToQueueItem() {
    if (this.selectedItemIndex === null) return;

    try {
      const item = this.queue.items[this.selectedItemIndex];
      
      const response = await chrome.runtime.sendMessage({
        action: 'jumpToQueueItem',
        targetIndex: this.selectedItemIndex
      });

      if (response && response.success) {
        this.setStatus('working', `Jumping to: ${item.sourceName || 'Unknown'}`);
        this.closeModal();
        await this.loadQueueStatus();
        this.updateAllUI();
      } else {
        this.setStatus('error', `Failed to jump to item: ${response?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error jumping to queue item:', error);
      this.setStatus('error', `Error: ${error.message}`);
    }
  }

  async deleteQueueItem() {
    if (this.selectedItemIndex === null) return;

    const item = this.queue.items[this.selectedItemIndex];
    const itemName = item.sourceName || 'Unknown';

    if (!confirm(`Remove "${itemName}" from the queue?`)) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'deleteQueueItem',
        targetIndex: this.selectedItemIndex
      });

      if (response && response.success) {
        this.setStatus('ready', `Removed: ${itemName}`);
        this.closeModal();
        await this.loadQueueStatus();
        this.updateAllUI();
      } else {
        this.setStatus('error', `Failed to remove item: ${response?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting queue item:', error);
      this.setStatus('error', `Error: ${error.message}`);
    }
  }

  // =============================================
  // BREAK TIMER UI MANAGEMENT
  // =============================================

  startBreakDisplayTimer() {
    if (this.breakTimerInterval) {
      return;
    }
    this.updateBreakDisplay(); 
    this.breakTimerInterval = setInterval(() => this.updateBreakDisplay(), 1000);
    console.log(`Started break display timer interval.`);
  }


  updateBreakDisplay() {
    if (!this.queue.breakEndTime || Date.now() >= this.queue.breakEndTime) {
      this.elements.breakTimeLeft.textContent = 'Resuming...';
      this.stopBreakDisplayTimer();
      return;
    }
    
    const now = Date.now();
    const endTime = this.queue.breakEndTime;
    
    const endDate = new Date(endTime);
    const timeString = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const remainingMs = endTime - now;
    const remainingMinutes = Math.floor(remainingMs / 60000);
    const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);
    
    if (document.activeElement !== this.elements.breakMinutesInput) {
      this.elements.breakMinutesInput.value = Math.ceil(remainingMs / 60000);
    }
    
    this.elements.breakTimeLeft.textContent = 
      `${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')} (until ${timeString})`;
  }

  stopBreakDisplayTimer() {
    if (this.breakTimerInterval) {
      clearInterval(this.breakTimerInterval);
      this.breakTimerInterval = null;
      console.log('Stopped break display timer interval.');
    }
  }


  // =============================================
  // MONITORING
  // =============================================

  startMonitoring() {
    this.syncWithBackground();

    setInterval(async () => {
      try {
        await Promise.all([
          this.checkAutomationStatus(),
          this.refreshDataCounts(),
          this.syncWithBackground()
        ]);
      } catch (error) {
        // Keep loop alive
      }
    }, 2000);
  }

  async syncWithBackground() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getQueueStatus' });
      if (!response || !response.success) {
        return;
      }

      const oldIsRunning = this.queue.isRunning;
      this.queue = response.queue;
      const newBreakTime = response.breakEndTime; 

      if (newBreakTime && newBreakTime > Date.now()) {
        this.queue.breakEndTime = newBreakTime;
        this.elements.breakTimer.style.display = 'flex';
        this.startBreakDisplayTimer();
      } else {
        this.queue.breakEndTime = null;
        this.elements.breakTimer.style.display = 'none';
        this.stopBreakDisplayTimer();
      }
      
      if (oldIsRunning !== this.queue.isRunning) {
        this.updateAllUI();
      }
      
      this.renderQueueList();

    } catch (error) {
      if (error.message && !error.message.includes('Could not establish connection')) {
        console.warn('Sync with background failed:', error.message);
      }
    }
  }

  async checkAutomationStatus() {
    try {
      const tab = await this.getCurrentTab();
      if (!tab || (!tab.url.includes('linkedin.com') && !tab.url.startsWith('file://'))) {
        return;
      }
      
      const response = await this.sendMessageToTab(tab.id, { action: 'getAutomationStatus' });
      if (response) {
        const wasRunning = this.automation.isRunning;
        this.automation.isRunning = response.isRunning || false;
        this.automation.status = response.status || 'Ready';
        
        if (wasRunning !== this.automation.isRunning) {
          this.updateAutomationUI();
        }
      }
    } catch (error) {
      // Content script may not be loaded yet, this is okay.
    }
  }

  async refreshDataCounts() {
    try {
      const result = await this.chromeStorage('get', ['totalExtracted']);
      const newTotal = result.totalExtracted || 0;
      
      if (newTotal !== this.data.totalExtracted) {
        this.data.totalExtracted = newTotal;
        this.updateStats();
        this.updateFileInfo();
      }
    } catch (error) {
      // Ignore intermittent refresh errors.
    }
  }

  // =============================================
  // QUEUE UI HELPERS
  // =============================================

  parseUrls(urlText) {
    return urlText.split('\n')
      .map(url => url.trim())
      .filter(url => url && url.includes('linkedin.com'))
      .map(url => {
        const isProfileUrl = url.includes('/in/');
        
        return {
          url,
          sourceName: isProfileUrl ? this.extractNameFromProfileUrl(url) : this.extractSourceFromSearchUrl(url),
          isProfileUrl: isProfileUrl,
          status: 'pending',
          error: null
        };
      });
  }

  extractNameFromProfileUrl(url) {
    try {
      const match = url.match(/\/in\/([^\/\?]+)/);
      if (match) {
        return match[1].replace(/-/g, ' ').replace(/\d+/g, '').trim()
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      return 'Profile';
    } catch {
      return 'Profile';
    }
  }

  extractSourceFromSearchUrl(url) {
    try {
      const urlObj = new URL(url);
      const connectionOf = urlObj.searchParams.get('facetConnectionOf') || urlObj.searchParams.get('connectionOf');
      return connectionOf ? decodeURIComponent(connectionOf) : 'Search Results';
    } catch {
      return 'Search Results';
    }
  }

  toggleQueueExpansion() {
    const isExpanded = this.elements.queueInputSection.style.display !== 'none';
    
    if (isExpanded) {
      this.elements.queueInputSection.style.display = 'none';
      this.elements.expandQueue.classList.remove('expanded');
    } else {
      this.elements.queueInputSection.style.display = 'block';
      this.elements.expandQueue.classList.add('expanded');
    }
    
    this.saveSettings();
  }

  toggleQueueList() {
    const isCollapsed = this.elements.queueItems.style.display === 'none';
    
    if (isCollapsed) {
      this.elements.queueItems.style.display = 'block';
      this.elements.collapseQueue.textContent = '▲';
    } else {
      this.elements.queueItems.style.display = 'none';
      this.elements.collapseQueue.textContent = '▼';
    }
  }

  // =============================================
  // DATA LOADING AND PERSISTENCE
  // =============================================

  async loadAllData() {
    try {
      const result = await this.chromeStorage('get', [
        'myConnections', 
        'totalExtracted'
      ]);
      
      this.data.myConnections = result.myConnections || [];
      this.data.totalExtracted = result.totalExtracted || 0;
      
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  async loadSettings() {
    try {
      const result = await this.chromeStorage('get', ['showNotifications', 'queueExpanded']);
      
      this.settings.showNotifications = result.showNotifications !== false;
      this.settings.queueExpanded = result.queueExpanded || false;
      
      this.elements.showNotifications.checked = this.settings.showNotifications;
      
      if (this.settings.queueExpanded || this.queue.items.length > 0) {
        this.elements.queueInputSection.style.display = 'block';
        this.elements.expandQueue.classList.add('expanded');
      }
      
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    try {
      this.settings.showNotifications = this.elements.showNotifications.checked;
      this.settings.queueExpanded = this.elements.expandQueue.classList.contains('expanded');
      
      await this.chromeStorage('set', {
        showNotifications: this.settings.showNotifications,
        queueExpanded: this.settings.queueExpanded
      });
      
      try {
        const tab = await this.getCurrentTab();
        if (tab && (tab.url.includes('linkedin.com') || tab.url.startsWith('file://'))) {
          await this.ensureContentScript(tab.id);
          await this.sendMessageToTab(tab.id, {
            action: 'setNotificationSettings',
            enabled: this.settings.showNotifications
          });
          console.log('Notification settings updated');
        }
      } catch (error) {
        console.log('Could not update content script notifications');
      }
      
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  // =============================================
  // MANUAL OPERATIONS
  // =============================================

  async grabMyConnections() {
    if (this.busy.dataOperation) return;
    this.busy.dataOperation = true;
    
    try {
      this.setStatus('working', 'Grabbing your connections...');
      this.elements.grabMyConnections.disabled = true;
      
      const tab = await this.getCurrentTab();
      if (!tab) throw new Error('No active tab');
      
      await this.ensureContentScript(tab.id);
      
      const response = await this.sendMessageToTab(tab.id, { action: 'extractMyConnections' });
      if (!response || !response.success) {
        throw new Error(response?.error || 'Extraction failed');
      }
      
      this.data.myConnections = response.data;
      
      const dataToSave = response.data.map(conn => ({
        type: 'my_connection',
        source: 'Self',
        name: conn.name,
        url: conn.url,
        mutualConnections: '',
        timestamp: new Date().toISOString()
      }));
      
      await this.saveToStorage(dataToSave);
      await this.chromeStorage('set', { myConnections: this.data.myConnections });
      
      const refreshed = await this.chromeStorage('get', ['totalExtracted']);
      this.data.totalExtracted = refreshed.totalExtracted || 0;
      
      this.setStatus('ready', `Found ${response.data.length} connections`);
      this.updateAllUI();
      
    } catch (error) {
      this.setStatus('error', `Failed: ${error.message}`);
    } finally {
      this.elements.grabMyConnections.disabled = false;
      this.busy.dataOperation = false;
    }
  }

  async grab2ndConnections() {
    if (this.busy.dataOperation) return;
    this.busy.dataOperation = true;
    
    try {
      this.setStatus('working', 'Grabbing 2nd degree connections...');
      this.elements.grab2ndConnections.disabled = true;
      
      const tab = await this.getCurrentTab();
      if (!tab) throw new Error('No active tab');
      
      await this.ensureContentScript(tab.id);
      
      const response = await this.sendMessageToTab(tab.id, { action: 'extractConnectionsFromSearchPage' });
      if (!response || !response.success) {
        throw new Error(response?.error || 'Extraction failed');
      }
      
      if (response.data.length === 0) {
        this.setStatus('ready', 'No profiles found on this page');
        return;
      }
      
      const dataToSave = response.data.map(profile => ({
        type: '2nd_degree',
        source: response.sourceConnection || 'Unknown',
        name: profile.name,
        url: profile.url,
        mutualConnections: profile.mutualConnections || '',
        timestamp: new Date().toISOString()
      }));
      
      await this.saveToStorage(dataToSave);
      
      const refreshed = await this.chromeStorage('get', ['totalExtracted']);
      this.data.totalExtracted = refreshed.totalExtracted || 0;
      
      this.setStatus('ready', `Grabbed ${response.data.length} profiles`);
      this.updateAllUI();
      
    } catch (error) {
      this.setStatus('error', `Failed: ${error.message}`);
    } finally {
      this.elements.grab2ndConnections.disabled = false;
      this.busy.dataOperation = false;
    }
  }

  // =============================================
  // UI UPDATES
  // =============================================

  updateAllUI() {
    this.updateStats();
    this.updateAutomationUI();
    this.updateQueueUI();
    this.updateFileInfo();
  }

  updateStats() {
    this.elements.connectionsCount.textContent = this.data.myConnections.length;
    this.elements.extractedCount.textContent = this.data.totalExtracted;
    this.elements.grab2ndConnections.disabled = this.data.myConnections.length === 0;
  }

  updateAutomationUI() {
    if (this.automation.isRunning) {
      this.elements.startAutomation.textContent = 'Stop Automation';
      this.elements.startAutomation.className = 'button auto running';
    } else {
      this.elements.startAutomation.textContent = 'Start Auto Collection';
      this.elements.startAutomation.className = 'button auto';
    }
  }

  updateQueueUI() {
    this.elements.queueProgress.textContent = `${this.queue.currentIndex} / ${this.queue.items.length}`;
    
    this.elements.queueStatus.style.display = this.queue.isRunning ? 'block' : 'none';
    
    const pendingCount = this.queue.items.filter(item => 
      item.status === 'pending' || item.status === 'failed'
    ).length;
    
    const hasIncompleteItems = pendingCount > 0;
    const hasAnyItems = this.queue.items.length > 0;
    
    if (this.queue.isRunning) {
      this.elements.startQueueAutomation.textContent = 'Stop Queue';
      this.elements.startQueueAutomation.className = 'button auto running';
      this.elements.startQueueAutomation.style.display = 'block';
      if (this.elements.resumeQueue) {
        this.elements.resumeQueue.style.display = 'none';
      }
    } else if (hasIncompleteItems) {
      this.elements.startQueueAutomation.textContent = 'Start Queue Automation';
      this.elements.startQueueAutomation.className = 'button auto';
      this.elements.startQueueAutomation.style.display = 'block';
      if (this.elements.resumeQueue) {
        this.elements.resumeQueue.textContent = `Resume Queue (${pendingCount} remaining)`;
        this.elements.resumeQueue.style.display = 'block';
      }
    } else if (hasAnyItems) {
      this.elements.startQueueAutomation.textContent = 'Start Queue Automation';
      this.elements.startQueueAutomation.className = 'button auto';
      this.elements.startQueueAutomation.style.display = 'block';
      if (this.elements.resumeQueue) {
        this.elements.resumeQueue.style.display = 'none';
      }
    } else {
      this.elements.startQueueAutomation.textContent = 'Start Queue Automation';
      this.elements.startQueueAutomation.className = 'button auto';
      this.elements.startQueueAutomation.style.display = 'block';
      if (this.elements.resumeQueue) {
        this.elements.resumeQueue.style.display = 'none';
      }
    }
    
    this.renderQueueList();
  }

  async updateFileInfo() {
    try {
      const result = await this.chromeStorage('get', ['csvMergeData']);
      const persistentCount = Object.keys(result.csvMergeData || {}).length;
      
      if (this.data.totalExtracted > 0 || persistentCount > 0) {
        const parts = [];
        if (this.data.totalExtracted > 0) parts.push(`${this.data.totalExtracted} in memory`);
        if (persistentCount > 0) parts.push(`${persistentCount} persistent`);
        
        this.elements.fileInfo.innerHTML = `${parts.join(' + ')} - Export merges all data to linkedin_connections.csv`;
        this.elements.fileInfo.style.display = 'block';
      } else {
        this.elements.fileInfo.style.display = 'none';
      }
    } catch (error) {
      this.elements.fileInfo.style.display = this.data.totalExtracted > 0 ? 'block' : 'none';
    }
  }

  async checkCurrentPage() {
    try {
      const tab = await this.getCurrentTab();
      if (!tab) {
        this.setStatus('error', 'Could not access current tab');
        return;
      }
      
      if (tab.url.startsWith('file://')) {
        this.setStatus('ready', 'Testing with local file');
      } else if (tab.url.includes('linkedin.com')) {
        if (tab.url.includes('/mynetwork/invite-connect/connections/')) {
          this.setStatus('ready', 'On connections page - ready to scrape');
        } else if (tab.url.includes('/search/results/people/')) {
          this.setStatus('ready', 'On search results - ready to extract');
        } else {
          this.setStatus('ready', 'On LinkedIn - navigate to connections');
        }
      } else {
        this.setStatus('error', 'Navigate to LinkedIn or open local HTML');
      }
    } catch (error) {
      this.setStatus('error', 'Could not check current page');
    }
  }

  setStatus(type, text) {
    this.elements.status.className = `status ${type}`;
    this.elements.status.textContent = text;
  }

  // =============================================
  // EXPORT AND DATA MANAGEMENT
  // =============================================
  async pushDataToDatabase() {
    if (this.busy.dataOperation) return;

    if (!confirm('This will send all locally stored connection data to the cloud database. Continue?')) {
      return;
    }

    this.busy.dataOperation = true;
    this.elements.pushToDatabase.disabled = true;

    try {
      this.setStatus('working', 'Pushing data to the database...');

      const response = await this.chromeAPI(() => chrome.runtime.sendMessage({ action: 'pushToDatabase' }));

      if (response && response.success) {
        if (response.count > 0) {
          this.setStatus('ready', `Successfully pushed ${response.count} profiles to the database!`);
        } else {
          this.setStatus('ready', 'No new data to push.');
        }
      } else {
        throw new Error(response?.error || 'An unknown error occurred.');
      }
    } catch (error) {
      this.setStatus('error', `Push failed: ${error.message}`);
    } finally {
      this.busy.dataOperation = false;
      this.elements.pushToDatabase.disabled = false;
    }
  }
  
  async exportToCSV() {
    if (this.busy.dataOperation) return;
    this.busy.dataOperation = true;
    
    try {
      this.setStatus('working', 'Generating CSV...');
      
      const result = await this.chromeStorage('get', ['allExtractedProfiles', 'csvMergeData']);
      
      const memoryProfiles = result.allExtractedProfiles || [];
      const persistentData = result.csvMergeData || {};
      
      if (memoryProfiles.length === 0 && Object.keys(persistentData).length === 0) {
        this.setStatus('error', 'No data to export');
        return;
      }
      
      const combinedData = { ...persistentData };
      
      for (const profile of memoryProfiles) {
        const uniqueKey = `${profile.url}|${profile.source}`;
        if (!combinedData[uniqueKey] || new Date(profile.timestamp) > new Date(combinedData[uniqueKey].timestamp)) {
          combinedData[uniqueKey] = profile;
        }
      }
      
      const allProfiles = Object.values(combinedData);
      allProfiles.sort((a, b) => {
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        return a.name.localeCompare(b.name);
      });
      
      const headers = ['Type', 'Source', 'Name', 'URL', 'Mutual_Connections', 'Timestamp'];
      const csvContent = [
        headers.join(','),
        ...allProfiles.map(row => [
          `"${row.type || ''}"`,
          `"${row.source || ''}"`,
          `"${row.name || ''}"`,
          `"${row.url || ''}"`,
          `"${row.mutualConnections || ''}"`,
          `"${row.timestamp || ''}"`
        ].join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      
      await this.chromeAPI(() => chrome.downloads.download({
        url: url,
        filename: this.fixedFileName,
        saveAs: false,
        conflictAction: 'overwrite'
      }));
      
      this.setStatus('ready', `Exported ${allProfiles.length} profiles`);
      console.log(`CSV Export: ${allProfiles.length} profiles`);
      
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
    } catch (error) {
      this.setStatus('error', `Export failed: ${error.message}`);
    } finally {
      this.busy.dataOperation = false;
    }
  }

  async debugCurrentPage() {
    try {
      this.setStatus('working', 'Debugging page...');
      
      const tab = await this.getCurrentTab();
      if (!tab) throw new Error('No active tab');
      
      await this.ensureContentScript(tab.id);
      
      const response = await this.sendMessageToTab(tab.id, { action: 'debugPage' });
      if (response && response.success) {
        console.log('=== PAGE DEBUG INFO ===', response.data);
        this.setStatus('ready', 'Debug complete - check console');
      } else {
        throw new Error('Debug failed');
      }
    } catch (error) {
      this.setStatus('error', `Debug failed: ${error.message}`);
    }
  }

  async clearAllData() {
    if (!confirm('Clear all scraped data? This will delete everything.')) return;
    
    try {
      this.data.myConnections = [];
      this.data.totalExtracted = 0;
      
      await this.chromeAPI(() => chrome.storage.local.clear());
      
      this.setStatus('ready', 'All data cleared');
      this.updateAllUI();
    } catch (error) {
      this.setStatus('error', `Clear failed: ${error.message}`);
    }
  }

  async clearMemoryOnly() {
    if (!confirm('Clear memory data only? Persistent CSV data will be preserved.')) return;
    
    try {
      this.data.myConnections = [];
      this.data.totalExtracted = 0;
      
      await this.chromeStorage('remove', ['myConnections', 'totalExtracted', 'allExtractedProfiles', 'extractedCombinations']);
      
      this.setStatus('ready', 'Memory cleared');
      this.updateAllUI();
    } catch (error) {
      this.setStatus('error', `Clear memory failed: ${error.message}`);
    }
  }

  async saveToStorage(dataArray) {
    if (!dataArray || dataArray.length === 0) return;
    
    try {
      const result = await this.chromeAPI(() => chrome.runtime.sendMessage({
        action: 'saveQuickExtraction',
        data: dataArray
      }));
      
      if (result && result.success) {
        const newCount = result.saved || 0;
        const updatedCount = result.updated || 0;
        const duplicateCount = result.duplicates || 0;
        console.log(`Saved ${newCount} new profiles, updated ${updatedCount} existing, skipped ${duplicateCount} older duplicates.`);
      } else {
        throw new Error('Background script save failed');
      }
    } catch (error) {
      console.error('Save to storage failed:', error);
    }
  }

  // =============================================
  // CHROME API HELPERS 
  // =============================================

  async getCurrentTab() {
    try {
      const tabs = await this.chromeAPI(() => chrome.tabs.query({ active: true, currentWindow: true }));
      return tabs?.[0];
    } catch (error) {
      console.error('Failed to get current tab:', error);
      return null;
    }
  }

  async ensureContentScript(tabId) {
    try {
      await this.sendMessageToTab(tabId, { action: 'ping' });
    } catch (error) {
      console.log('Content script not loaded, injecting...');
      try {
        await this.chromeAPI(() => chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        }));
        await this.delay(1000);
        console.log('Content script injected successfully');
      } catch (injectionError) {
        console.error('Content script injection failed:', injectionError);
        throw new Error(`Failed to inject content script: ${injectionError.message}`);
      }
    }
  }

  async sendMessageToTab(tabId, message) {
    try {
      return await this.chromeAPI(() => chrome.tabs.sendMessage(tabId, message));
    } catch (error) {
      throw new Error(`Could not establish connection. Receiving end does not exist.`);
    }
  }

  async chromeStorage(operation, data) {
    if (operation === 'get') {
      return await this.chromeAPI(() => chrome.storage.local.get(data));
    } else if (operation === 'set') {
      return await this.chromeAPI(() => chrome.storage.local.set(data));
    } else if (operation === 'remove') {
      return await this.chromeAPI(() => chrome.storage.local.remove(data));
    }
  }

  async chromeAPI(apiCall) {
    try {
      if (!chrome?.runtime?.id) throw new Error('Extension context not available');
      return await apiCall();
    } catch (error) {
      console.error('Chrome API call failed:', error);
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new LinkedInScraperPopup();
});