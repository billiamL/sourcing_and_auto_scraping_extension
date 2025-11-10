const SUPABASE_URL = 'https://iqeopislujokppaflnoc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxZW9waXNsdWpva3BwYWZsbm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg3ODA2OTgsImV4cCI6MjA3NDM1NjY5OH0.AHzzpRt_5C5dxWNP6aW2qLHpMO09Q5MJugQXWPiVijY';
const SUPABASE_TABLE = 'linkedin_connections';

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

class LinkedInScraperBrain {
  constructor() {
    // Queue system
    this.queue = {
      items: [],
      currentIndex: 0,
      isRunning: false,
      breakEndTime: null
    };
    
    // Single page automation state
    this.singlePageState = {
      isRunning: false,
      currentPage: 1,
      maxPage: null,
      totalConnections: 0,
      stagnationCount: 0
    };
    
    this.scraperWindowId = null;
    this.scraperTabId = null;
    this.QUEUE_BREAK_ALARM = 'queue_break_timer';
    
    this.setupEventListeners();
    this.loadPersistedState();
    console.log('LinkedIn Scraper Brain initialized');
  }

  setupEventListeners() {
    chrome.runtime.onInstalled.addListener(() => {
      console.log('LinkedIn Scraper Brain installed');
      this.updateBadge('');
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });

    chrome.alarms.onAlarm.addListener((alarm) => this.handleAlarm(alarm));
    chrome.windows.onRemoved.addListener((windowId) => this.handleWindowClosed(windowId));
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      let result;
      switch (request.action) {
        // Data management
        case 'saveQuickExtraction':
          result = await this.saveExtractedData(request.data);
          break;
          
        // Single page automation
        case 'startSinglePageAutomation':
          result = await this.startSinglePageAutomation(sender.tab);
          break;
        case 'stopSinglePageAutomation':
          result = await this.stopSinglePageAutomation();
          break;
          
        // Queue automation
        case 'startQueue':
          result = await this.startQueueAutomation(request.queueItems);
          break;
        case 'stopQueue':
          result = await this.stopQueueAutomation();
          break;
        case 'clearQueue':
          result = await this.clearQueue();
          break;
        case 'getQueueStatus':
          result = await this.getQueueStatus();
          break;
        case 'skipBreak':
          result = await this.skipBreak();
          break;
        case 'setBreakEndTime':
          result = await this.setBreakEndTime(request.endTime);
          break;
        case 'reorderQueue':
          result = await this.reorderQueue(request.newItems, request.newCurrentIndex);
          break;
        case 'jumpToQueueItem':
          result = await this.jumpToQueueItem(request.targetIndex);
          break;
        case 'deleteQueueItem':
          result = await this.deleteQueueItem(request.targetIndex);
          break;

        case 'pushToDatabase':
          result = await this.pushDataToCloud();
          break;
          
        default:
          result = { success: false, error: 'Unknown action' };
      }
      sendResponse(result);
    } catch (error) {
      console.error('Brain message handling error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // =============================================
  // SINGLE PAGE AUTOMATION - BRAIN ORCHESTRATED
  // =============================================

  async startSinglePageAutomation(targetTab) {
    if (this.singlePageState.isRunning) {
      return { success: false, error: 'Single page automation already running' };
    }

    if (!targetTab) {
      return { success: false, error: 'No target tab provided' };
    }

    try {
      // Start anti-throttling
      await this.startSilentAudio();
      
      // Initialize state
      this.singlePageState = {
        isRunning: true,
        currentPage: 1,
        maxPage: null,
        totalConnections: 0,
        stagnationCount: 0,
        tabId: targetTab.id
      };
      
      // Start the orchestration loop
      this.orchestrateSinglePageAutomation();
      
      return { success: true, message: 'Single page automation started' };
    } catch (error) {
      await this.stopSilentAudio();
      return { success: false, error: error.message };
    }
  }

  async stopSinglePageAutomation() {
    this.singlePageState.isRunning = false;
    await this.stopSilentAudio();
    return { success: true, message: 'Single page automation stopped' };
  }

  async orchestrateSinglePageAutomation() {
    console.log('Starting single page automation orchestration');
    
    while (this.singlePageState.isRunning) {
      try {
        // Step 1: Get current page info
        const pageInfo = await this.sendCommandToHand(this.singlePageState.tabId, {
          action: 'getCurrentPageInfo'
        });
        
        if (!pageInfo || !pageInfo.success) {
          console.error('Failed to get page info, stopping');
          break;
        }
        
        this.singlePageState.currentPage = pageInfo.currentPage;
        this.singlePageState.maxPage = pageInfo.maxPage;
        
        console.log(`Processing page ${this.singlePageState.currentPage}${this.singlePageState.maxPage ? ` of ${this.singlePageState.maxPage}` : ''}`);
        
        // Step 2: Wait for page to be ready
        const readyResult = await this.sendCommandToHand(this.singlePageState.tabId, {
          action: 'waitForPageReady'
        });
        
        if (!readyResult?.success) {
          console.warn('Page ready check failed, continuing anyway');
        }
        
        // Step 3: Extract profiles from current page
        const extractResult = await this.sendCommandToHand(this.singlePageState.tabId, {
          action: 'extractCurrentPage'
        });
        
        if (extractResult?.success && extractResult.data?.length > 0) {
          console.log(`Extracted ${extractResult.data.length} profiles from page ${this.singlePageState.currentPage}`);
          
          // Save the data
          const dataToSave = extractResult.data.map(profile => ({
            type: '2nd_degree',
            source: extractResult.sourceConnection || 'Unknown',
            name: profile.name,
            url: profile.url,
            mutualConnections: profile.mutualConnections || '',
            timestamp: new Date().toISOString()
          }));
          
          await this.saveExtractedData(dataToSave);
          this.singlePageState.totalConnections += extractResult.data.length;
          this.singlePageState.stagnationCount = 0;
        } else {
          console.warn(`No profiles extracted from page ${this.singlePageState.currentPage}`);
          this.singlePageState.stagnationCount++;
        }
        
        // Step 4: Check if this is the last page
        const isLastPage = await this.sendCommandToHand(this.singlePageState.tabId, {
          action: 'isLastPage'
        });
        
        if (isLastPage?.isLastPage) {
          console.log(`Reached last page. Automation complete! Total: ${this.singlePageState.totalConnections}`);
          break;
        }
        
        // Step 5: Perform realistic scrolling
        await this.sendCommandToHand(this.singlePageState.tabId, {
          action: 'realisticScroll'
        });
        
        // Step 6: Click next button
        const nextResult = await this.sendCommandToHand(this.singlePageState.tabId, {
          action: 'clickNextButton'
        });
        
        if (!nextResult?.success) {
          console.log('No next button found, stopping automation');
          break;
        }
        
        // Step 7: Brain-controlled delay between pages
        const delayTime = 2000 + Math.random() * 3000; // 2-5 seconds
        console.log(`Waiting ${Math.round(delayTime/1000)}s before next page...`);
        await this.delay(delayTime);
        
        // Step 8: Check for stagnation
        if (this.singlePageState.stagnationCount >= 3) {
          console.error('Too many failed extractions, stopping');
          break;
        }
        
      } catch (error) {
        console.error('Error in automation loop:', error);
        break;
      }
    }
    
    // Cleanup
    await this.stopSinglePageAutomation();
    console.log(`Single page automation completed. Total connections: ${this.singlePageState.totalConnections}`);
  }

  // =============================================
  // QUEUE AUTOMATION - BRAIN ORCHESTRATED  
  // =============================================

  async startQueueAutomation(queueItems) {
    if (this.queue.isRunning) {
      return { success: false, error: 'Queue already running' };
    }

    if (queueItems) {
      this.queue.items = queueItems;
    }

    this.queue.currentIndex = this.findNextPendingIndex();
    if (this.queue.currentIndex === -1) {
      return { success: false, error: 'No pending items to process' };
    }

    this.queue.isRunning = true;

    try {
      // Create scraper tab if needed
      if (!this.scraperTabId) {
        const tab = await chrome.tabs.create({
          url: 'https://www.linkedin.com',
          active: false
        });
        this.scraperTabId = tab.id;
        this.scraperWindowId = tab.windowId;
      }

      await this.startSilentAudio();
      await this.saveQueue();
      
      // Start queue orchestration
      this.orchestrateQueueAutomation();
      
      return { success: true, message: 'Queue automation started' };
    } catch (error) {
      this.queue.isRunning = false;
      return { success: false, error: error.message };
    }
  }

  async orchestrateQueueAutomation() {
    console.log('Starting queue automation orchestration');
    
    while (this.queue.isRunning && this.queue.currentIndex < this.queue.items.length) {
      const item = this.queue.items[this.queue.currentIndex];
      console.log(`Processing queue item ${this.queue.currentIndex + 1}/${this.queue.items.length}: ${item.url}`);
      
      item.status = 'processing';
      await this.saveQueue();
      
      try {
        const result = await this.processQueueItem(item);
        
        if (result.success) {
          item.status = 'completed';
          item.sourceName = result.sourceName || item.sourceName;
          item.profilesFound = result.profilesFound || 0;
          console.log(`Completed item ${this.queue.currentIndex + 1}: ${item.profilesFound} profiles`);
        } else {
          item.status = 'failed';
          item.error = result.error;
          console.log(`Failed item ${this.queue.currentIndex + 1}: ${result.error}`);
        }
      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
        console.error(`Unhandled error on item ${this.queue.currentIndex + 1}:`, error);
      }
      
      await this.saveQueue();
      
      // Find next item
      const nextIndex = this.findNextPendingIndex(this.queue.currentIndex + 1);
      if (nextIndex === -1) {
        console.log('Queue completed - no more pending items');
        break;
      }
      
      this.queue.currentIndex = nextIndex;
      
      // Break between items
      if (this.queue.isRunning) {
        await this.startBreakTimer();
        
        // Wait for break to complete
        while (this.queue.breakEndTime && Date.now() < this.queue.breakEndTime && this.queue.isRunning) {
          await this.delay(5000);
        }
      }
    }
    
    await this.stopQueueAutomation();
  }

  async processQueueItem(item) {
    try {
      // Step 1: Navigate to the URL (profile or search page)
      let finalUrl = item.url;
      let sourceName = item.sourceName;
      
      if (item.isProfileUrl) {
        // Navigate to profile first
        await this.navigateTab(finalUrl);
        await this.delay(3000); // Wait for page load
        
        // Wait for profile page to be ready
        const profileReady = await this.sendCommandToHand(this.scraperTabId, {
          action: 'waitForPageReady'
        });
        
        if (!profileReady?.success) {
          console.warn('Profile page not ready, continuing anyway');
        }
        
        // Get connections URL from profile
        const connectionsResult = await this.sendCommandToHand(this.scraperTabId, {
          action: 'findConnectionsUrl'
        });
        
        if (!connectionsResult?.success) {
          throw new Error(connectionsResult?.error || 'Could not find connections link');
        }
        
        finalUrl = connectionsResult.connectionsUrl;
        sourceName = connectionsResult.profileName || sourceName;
        item.sourceName = sourceName;
        await this.saveQueue();
      }
      
      // Step 2: Navigate to final URL (connections search page)
      await this.navigateTab(finalUrl);
      await this.delay(3000);
      
      // Wait for search page to be ready before extraction
      const searchReady = await this.sendCommandToHand(this.scraperTabId, {
        action: 'waitForPageReady'
      });
      
      if (!searchReady?.success) {
        console.warn('Search page not ready after navigation, continuing anyway');
      }
      
      // Step 3: Run single-page automation on this URL
      let totalProfiles = 0;
      let currentPage = 1;
      
      while (this.queue.isRunning) {
        // Get page info
        const pageInfo = await this.sendCommandToHand(this.scraperTabId, {
          action: 'getCurrentPageInfo'
        });
        
        if (!pageInfo?.success) break;
        
        console.log(`Queue item processing page ${pageInfo.currentPage}`);
        
        // Extract from current page
        const extractResult = await this.sendCommandToHand(this.scraperTabId, {
          action: 'extractCurrentPage'
        });
        
        if (extractResult?.success && extractResult.data?.length > 0) {
          const dataToSave = extractResult.data.map(profile => ({
            type: '2nd_degree',
            source: sourceName || 'Unknown',
            name: profile.name,
            url: profile.url,
            mutualConnections: profile.mutualConnections || '',
            timestamp: new Date().toISOString()
          }));
          
          await this.saveExtractedData(dataToSave);
          totalProfiles += extractResult.data.length;
        }
        
        // Check if last page
        const isLastPage = await this.sendCommandToHand(this.scraperTabId, {
          action: 'isLastPage'
        });
        
        if (isLastPage?.isLastPage) break;
        
        // Scroll and click next
        await this.sendCommandToHand(this.scraperTabId, { action: 'realisticScroll' });
        const nextResult = await this.sendCommandToHand(this.scraperTabId, { action: 'clickNextButton' });
        
        if (!nextResult?.success) break;
        
        await this.delay(2000 + Math.random() * 2000);
        
        // Wait for next page to be ready
        const nextPageReady = await this.sendCommandToHand(this.scraperTabId, {
          action: 'waitForPageReady'
        });
        
        if (!nextPageReady?.success) {
          console.warn('Next page not ready, continuing anyway');
        }
        
        currentPage++;
      }
      
      return { 
        success: true, 
        sourceName: sourceName,
        profilesFound: totalProfiles
      };
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // =============================================
  // COMMUNICATION WITH CONTENT SCRIPT "HAND"
  // =============================================

  async sendCommandToHand(tabId, command, timeout = 30000) {
    return new Promise(async (resolve) => {
      let timeoutId;
      let resolved = false;
      
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        resolved = true;
      };
      
      timeoutId = setTimeout(() => {
        if (!resolved) {
          cleanup();
          resolve({ success: false, error: 'Command timeout' });
        }
      }, timeout);
      
      try {
        // Ensure content script is loaded
        await this.ensureContentScript(tabId);
        
        const result = await chrome.tabs.sendMessage(tabId, command);
        
        if (!resolved) {
          cleanup();
          resolve(result || { success: false, error: 'No response' });
        }
      } catch (error) {
        if (!resolved) {
          cleanup();
          resolve({ success: false, error: error.message });
        }
      }
    });
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  async navigateTab(url) {
    if (!this.scraperTabId) {
      throw new Error("No scraper tab available");
    }
    
    console.log(`Navigating to ${url.substring(0, 100)}...`);
    await chrome.tabs.update(this.scraperTabId, { url: url, active: false });
  }

  async ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
      console.log('Injecting content script...');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await this.delay(2000);
    }
  }

  async pushDataToCloud() {
    try {
      console.log('Preparing to push all local data to Supabase...');
      const result = await this.getStorageData(['csvMergeData']);
      const allData = result.csvMergeData || {};
      const allProfiles = Object.values(allData);

      if (allProfiles.length === 0) {
        console.log('No local data to push.');
        return { success: true, count: 0, message: 'No new data to push.' };
      }

      console.log(`Pushing ${allProfiles.length} profiles to Supabase...`);

      // Transform data for Supabase
      const supabaseData = allProfiles.map(profile => ({
        connection_type: profile.type || null,
        source: profile.source || null,
        name: profile.name || null,
        profile_url: profile.url || null,
        mutual_connections: profile.mutualConnections || null,
        extracted_at: profile.lastScrapedAt || profile.timestamp || new Date().toISOString(),
        raw_data: JSON.stringify(profile)
      }));

      const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(supabaseData)
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Supabase API Error: ${response.status} - ${errorData}`);
      }

      console.log(`Successfully pushed ${allProfiles.length} profiles to Supabase`);
      return { success: true, count: allProfiles.length };

    } catch (error) {
      console.error('Failed to push data to Supabase:', error);
      return { success: false, error: error.message };
    }
  }

  // =============================================
  // ANTI-THROTTLING AUDIO
  // =============================================

  async hasOffscreenDocument() {
    if ('hasDocument' in chrome.offscreen) {
      return await chrome.offscreen.hasDocument();
    }
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return contexts.length > 0;
  }

  async startSilentAudio() {
    if (await this.hasOffscreenDocument()) {
      console.log('Offscreen document already exists');
    } else {
      console.log('Creating offscreen document for anti-throttling');
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Prevent JavaScript throttling during automation'
      });
    }
  }

  async stopSilentAudio() {
    if (await this.hasOffscreenDocument()) {
      console.log('Stopping anti-throttling audio');
      await chrome.offscreen.closeDocument();
    }
  }

  // =============================================
  // DATA MANAGEMENT
  // =============================================

  async saveExtractedData(dataArray) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return { success: true, saved: 0, updated: 0, duplicates: 0 };
    }

    try {
      const result = await this.getStorageData(['totalExtracted', 'allExtractedProfiles', 'extractedCombinations', 'csvMergeData']);
      let totalExtracted = result.totalExtracted || 0;
      let allExtractedProfiles = Array.isArray(result.allExtractedProfiles) ? result.allExtractedProfiles : [];
      const extractedCombinations = new Set(result.extractedCombinations || []);
      const csvMergeData = result.csvMergeData || {};

      const indexMap = new Map();
      allExtractedProfiles.forEach((profile, index) => {
        if (profile?.url) {
          indexMap.set(`${profile.url}|${profile.source}`, index);
        }
      });

      let newCount = 0;
      let updatedCount = 0;

      for (const originalProfile of dataArray) {
        if (!originalProfile?.url) {
          continue;
        }

        const timestamp = originalProfile.timestamp || new Date().toISOString();
        const profile = { ...originalProfile, timestamp };
        const key = `${profile.url}|${profile.source}`;

        extractedCombinations.add(key);

        if (indexMap.has(key)) {
          const existingIndex = indexMap.get(key);
          allExtractedProfiles[existingIndex] = profile;
          csvMergeData[key] = profile;
          updatedCount++;
        } else {
          allExtractedProfiles.push(profile);
          indexMap.set(key, allExtractedProfiles.length - 1);
          csvMergeData[key] = profile;
          newCount++;
        }
      }

      const duplicatesCount = Math.max(dataArray.length - newCount - updatedCount, 0);

      if (newCount > 0 || updatedCount > 0) {
        if (newCount > 0) {
          totalExtracted += newCount;
          this.updateBadge(totalExtracted.toString());
        }

        await this.setStorageData({
          totalExtracted,
          allExtractedProfiles,
          extractedCombinations: Array.from(extractedCombinations),
          csvMergeData
        });
      }

      return {
        success: true,
        saved: newCount,
        updated: updatedCount,
        duplicates: duplicatesCount
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // =============================================
  // QUEUE MANAGEMENT HELPERS
  // =============================================

  findNextPendingIndex(startFrom = 0) {
    return this.queue.items.findIndex((item, i) => 
      i >= startFrom && item.status !== 'completed'
    );
  }

  async saveQueue() {
    try {
      const queueData = {
        ...this.queue,
        scraperWindowId: this.scraperWindowId,
        scraperTabId: this.scraperTabId
      };
      await this.setStorageData({ persistentQueue: queueData });
    } catch (error) {
      console.error('Error saving queue:', error);
    }
  }

  async loadPersistedState() {
    try {
      const result = await this.getStorageData(['persistentQueue', 'totalExtracted']);
      
      if (result.persistentQueue) {
        this.queue = { ...this.queue, ...result.persistentQueue };
        this.scraperWindowId = result.persistentQueue.scraperWindowId || null;
        this.scraperTabId = result.persistentQueue.scraperTabId || null;
      }
      
      if (result.totalExtracted) {
        this.updateBadge(result.totalExtracted.toString());
      }
      
    } catch (error) {
      console.error('Error loading persisted state:', error);
    }
  }

  async startBreakTimer() {
    const breakMinutes = 4 + Math.random() * 3;
    const breakEndTime = Date.now() + (breakMinutes * 60 * 1000);
    console.log(`Starting ${Math.ceil(breakMinutes)} minute break`);
    this.queue.breakEndTime = breakEndTime;
    await this.saveQueue();
    chrome.alarms.create(this.QUEUE_BREAK_ALARM, { when: breakEndTime });
  }

  async handleAlarm(alarm) {
    if (alarm.name === this.QUEUE_BREAK_ALARM) {
      console.log('Break completed, resuming automation');
      this.queue.breakEndTime = null;
      await this.saveQueue();
    }
  }

  async stopQueueAutomation() {
    this.queue.isRunning = false;
    await chrome.alarms.clear(this.QUEUE_BREAK_ALARM);
    this.queue.breakEndTime = null;
    
    await this.stopSilentAudio();
    
    this.scraperWindowId = null;
    this.scraperTabId = null;
    await this.saveQueue();
    
    return { success: true, message: 'Queue automation stopped' };
  }

  async clearQueue() {
    await this.stopQueueAutomation();
    this.queue.items = [];
    this.queue.currentIndex = 0;
    await this.removeStorageData(['persistentQueue']);
    return { success: true, message: 'Queue cleared' };
  }

  async getQueueStatus() {
    const alarms = await chrome.alarms.getAll();
    const breakAlarm = alarms.find(a => a.name === this.QUEUE_BREAK_ALARM);
    return { 
      success: true, 
      queue: this.queue, 
      breakEndTime: breakAlarm ? breakAlarm.scheduledTime : null 
    };
  }

  async skipBreak() {
    await chrome.alarms.clear(this.QUEUE_BREAK_ALARM);
    this.queue.breakEndTime = null;
    await this.saveQueue();
    return { success: true };
  }

  async setBreakEndTime(endTime) {
    if (!endTime || endTime <= Date.now()) {
      return { success: false, error: 'Invalid end time' };
    }
    chrome.alarms.create(this.QUEUE_BREAK_ALARM, { when: endTime });
    this.queue.breakEndTime = endTime;
    await this.saveQueue();
    return { success: true };
  }

  async reorderQueue(newItems, newCurrentIndex) {
    this.queue.items = newItems;
    if (newCurrentIndex !== null) {
      this.queue.currentIndex = newCurrentIndex;
    }
    await this.saveQueue();
    return { success: true };
  }

  async jumpToQueueItem(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.queue.items.length) {
      return { success: false, error: 'Invalid index' };
    }
    
    this.queue.items[targetIndex].status = 'pending';
    this.queue.currentIndex = targetIndex;
    await this.saveQueue();
    return { success: true };
  }

  async deleteQueueItem(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.queue.items.length) {
      return { success: false, error: 'Invalid index' };
    }
    
    this.queue.items.splice(targetIndex, 1);
    if (targetIndex < this.queue.currentIndex) {
      this.queue.currentIndex--;
    }
    await this.saveQueue();
    return { success: true };
  }

  handleWindowClosed(windowId) {
    if (windowId === this.scraperWindowId) {
      console.log('Scraper window closed, stopping automation');
      this.stopQueueAutomation();
    }
  }

  updateBadge(text) {
    try {
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
    } catch (e) {
      // Ignore badge errors
    }
  }

  // Storage helpers
  async getStorageData(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(result);
      });
    });
  }

  async setStorageData(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  }

  async removeStorageData(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize the brain
const scraperBrain = new LinkedInScraperBrain();