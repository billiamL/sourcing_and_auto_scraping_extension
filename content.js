// content.js

class LinkedInScraperHand {
  constructor() {
    this.currentPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.showNotifications = true;
    this.activeNotifications = new Set();
    
    this.setupMessageListener();
    this.setupKeyListener();
    
    console.log('LinkedIn Scraper Hand loaded - awaiting Brain commands');
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleCommand(request, sender, sendResponse);
      return true; // Keep message channel open
    });
  }

  setupKeyListener() {
    document.addEventListener('keydown', async (event) => {
      // Manual extraction shortcuts
      if (event.key === '`' && !event.shiftKey && !event.ctrlKey) {
        event.preventDefault();
        const result = await this.executeManualExtraction();
        this.showNotification(`Manual: ${result.success ? `${result.data?.length || 0} profiles` : 'Failed'}`, 
                             result.success ? 'success' : 'error');
      }
      
      // Tell brain to start single-page automation
      if (event.key === '`' && event.shiftKey) {
        event.preventDefault();
        try {
          chrome.runtime.sendMessage({ action: 'startSinglePageAutomation' });
        } catch (error) {
          console.log('Could not contact brain for automation start');
        }
      }
    });
  }

  async handleCommand(request, sender, sendResponse) {
    try {
      let result;

      switch (request.action) {
        // ===== DIRECT EXTRACTION COMMANDS =====
        case 'extractMyConnections':
          result = await this.extractMyConnections();
          break;
        case 'extractConnectionsFromSearchPage':
          result = await this.extractConnectionsFromSearchPage();
          break;
        case 'extractCurrentPage':
          result = await this.extractCurrentPage();
          break;

        // ===== PAGE NAVIGATION COMMANDS =====
        case 'getCurrentPageInfo':
          result = this.getCurrentPageInfo();
          break;
        case 'isLastPage':
          result = this.isLastPage();
          break;
        case 'waitForPageReady':
          result = await this.waitForPageReady();
          break;

        // ===== USER INTERACTION COMMANDS =====
        case 'clickNextButton':
          result = await this.clickNextButton();
          break;
        case 'realisticScroll':
          result = await this.realisticScroll();
          break;

        // ===== PROFILE ANALYSIS COMMANDS =====
        case 'findConnectionsUrl':
          result = this.findConnectionsUrlFromProfile();
          break;
        case 'getSourceConnection':
          result = { success: true, sourceName: this.findSourceConnectionFromPage() };
          break;

        // ===== UTILITY COMMANDS =====
        case 'ping':
          result = { success: true, message: 'Hand is ready' };
          break;
        case 'debugPage':
          result = this.debugCurrentPage();
          break;
        case 'setNotificationSettings':
          this.showNotifications = request.enabled;
          result = { success: true };
          break;

        // ===== LEGACY/MANUAL COMMANDS =====
        case 'startAutomation':
        case 'stopAutomation':
        case 'getAutomationStatus':
          result = { success: false, error: 'Automation control moved to Brain. Use manual shortcuts.' };
          break;

        default:
          result = { success: false, error: 'Unknown command' };
      }

      sendResponse(result);
    } catch (error) {
      console.error('Command execution error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // =============================================
  // MANUAL EXTRACTION (for keyboard shortcuts)
  // =============================================

  async executeManualExtraction() {
    console.log('Manual extraction initiated');
    
    try {
      let result;
      if (this.isConnectionsPage()) {
        result = await this.extractMyConnections();
      } else if (this.isSearchResultsPage() || this.hasSearchResults()) {
        result = await this.extractConnectionsFromSearchPage();
      } else {
        return { success: false, error: 'Not on a supported LinkedIn page' };
      }
      
      if (result.success && result.data?.length > 0) {
        // Store locally and try to send to background
        this.storeDataLocally(result.data, result.sourceConnection, this.isConnectionsPage() ? 'connections' : 'search');
        
        try {
          const dataToSave = result.data.map(profile => ({
            type: this.isConnectionsPage() ? 'my_connection' : '2nd_degree',
            source: this.isConnectionsPage() ? 'Self' : (result.sourceConnection || 'Unknown'),
            name: profile.name,
            url: profile.url,
            mutualConnections: profile.mutualConnections || '',
            timestamp: new Date().toISOString()
          }));
          
          chrome.runtime.sendMessage({
            action: 'saveQuickExtraction',
            data: dataToSave
          });
        } catch (error) {
          console.log('Could not send to background, data stored locally');
        }
      }
      
      return result;
    } catch (error) {
      console.error('Manual extraction error:', error);
      return { success: false, error: error.message };
    }
  }

  // =============================================
  // EXTRACTION COMMANDS (called by Brain)
  // =============================================

  async extractCurrentPage() {
    if (this.isConnectionsPage()) {
      return await this.extractMyConnections();
    } else {
      return await this.extractConnectionsFromSearchPage();
    }
  }

  async extractMyConnections() {
    console.log('Extracting my connections...');
    
    try {
      if (!this.isPageReady()) {
        await this.delay(1000);
      } else {
        await this.delay(200); 
      }
      
      const connectionDetails = [];
      const seenUrls = new Set(); 
      
      // Method 1: Live connection cards (most reliable)
      const liveSelectors = '.mn-connection-card__details, .mn-connection-card, [data-view-name="connection-card"], .artdeco-entity-lockup';
      const liveCards = document.querySelectorAll(liveSelectors);
      console.log(`Found ${liveCards.length} live connection cards`);
      
      if (liveCards.length > 0) {
        const linkSelectors = 'a.mn-connection-card__link[href*="/in/"], a[href*="/in/"]';
        const nameSelectors = [
          '.mn-connection-card__name',
          '.artdeco-entity-lockup__title a',
          '.t-16.t-black.t-bold',
          'span[aria-hidden="true"]:not(.visually-hidden)',
          'span.t-bold'
        ];
        
        for (let card of liveCards) {
          try {
            const linkElement = card.querySelector(linkSelectors);
            if (!linkElement) continue;
            
            const profileUrl = linkElement.getAttribute('href').split('?')[0];
            if (seenUrls.has(profileUrl)) continue;
            seenUrls.add(profileUrl);
            
            let name = '';
            for (let selector of nameSelectors) {
              const nameElement = card.querySelector(selector);
              if (nameElement && nameElement.textContent.trim()) {
                name = nameElement.textContent.trim();
                break;
              }
            }
            
            if (name && profileUrl) {
              connectionDetails.push({ name, url: profileUrl });
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      // Method 2: Saved HTML connection cards (fallback)
      if (connectionDetails.length === 0) {
        const savedCards = document.querySelectorAll('div[data-view-name="connections-list"] > div[componentkey]');
        console.log(`Found ${savedCards.length} saved HTML connection cards`);
        
        for (let card of savedCards) {
          try {
            const linkElement = card.querySelector('a[data-view-name="connections-profile"]');
            if (!linkElement) continue;
            
            const profileUrl = linkElement.getAttribute('href').split('?')[0];
            if (seenUrls.has(profileUrl)) continue;
            seenUrls.add(profileUrl);
            
            let name = '';
            const nameSelectors = ['p', 'span[aria-hidden="true"]', 'p > a[href*="/in/"]', 'div[data-view-name="connections-name"]'];
            
            for (let selector of nameSelectors) {
              const nameElement = card.querySelector(selector);
              if (nameElement && nameElement.textContent.trim()) {
                name = nameElement.textContent.trim();
                break;
              }
            }
            
            if (!name) {
              const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
              if (urlMatch) {
                name = urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim();
              }
            }
            
            if (name && profileUrl) {
              connectionDetails.push({ name, url: profileUrl });
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      // Method 3: Alternative search/result cards (last resort)
      if (connectionDetails.length === 0) {
        const alternativeCards = document.querySelectorAll('.search-result, .entity-result, [data-entity-urn], .reusable-search__entity-result');
        console.log(`Found ${alternativeCards.length} alternative connection cards`);
        
        for (let card of alternativeCards) {
          try {
            const linkElement = card.querySelector('a[href*="/in/"]');
            if (!linkElement) continue;
            
            const profileUrl = linkElement.getAttribute('href').split('?')[0];
            if (seenUrls.has(profileUrl)) continue;
            seenUrls.add(profileUrl);
            
            let name = '';
            const nameSelectors = [
              '.entity-result__title-text span[aria-hidden="true"]',
              '.search-result__result-link',
              'span[dir="ltr"] span[aria-hidden="true"]',
              'h3 span',
              'span.t-bold',
              'span[aria-hidden="true"]:not(.visually-hidden)'
            ];
            
            for (let selector of nameSelectors) {
              const nameElement = card.querySelector(selector);
              if (nameElement && nameElement.textContent.trim()) {
                name = nameElement.textContent.trim();
                break;
              }
            }
            
            if (!name) {
              const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
              if (urlMatch) {
                name = urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim();
              }
            }
            
            if (name && profileUrl) {
              connectionDetails.push({ name, url: profileUrl });
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      console.log(`Extracted ${connectionDetails.length} connections`);
      
      return {
        success: true,
        data: connectionDetails
      };
      
    } catch (error) {
      console.error('Error extracting my connections:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async extractConnectionsFromSearchPage() {
    console.log('Extracting connections from search page...');
    
    try {
      await this.delay(this.isPageReady() ? 100 : 400);
      
      const profileDetails = [];
      let sourceConnectionName = this.findSourceConnectionFromPage();
      
      // Try different extraction methods
      const searchResults = this.extractFromSearchResults();
      if (searchResults.length > 0) {
        profileDetails.push(...searchResults);
      } else {
        const connectionsList = this.extractFromConnectionsList();
        if (connectionsList.length > 0) {
          profileDetails.push(...connectionsList);
        } else {
          const alternativeResults = await this.extractConnectionsAlternative();
          profileDetails.push(...alternativeResults);
        }
      }
      
      console.log(`Source: ${sourceConnectionName || 'Unknown'}, Extracted: ${profileDetails.length} profiles`);
      
      return {
        success: true,
        data: profileDetails,
        sourceConnection: sourceConnectionName
      };
      
    } catch (error) {
      console.error('Error extracting from search page:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // =============================================
  // SEARCH RESULTS EXTRACTION (Complex Logic Preserved)
  // =============================================

  extractFromSearchResults() {
    const profiles = [];
    
    const containerSelectors = '.presence-entity.presence-entity--size-3, [data-view-name="search-entity-result-universal-template"], [data-chameleon-result-urn], .reusable-search__entity-result, .entity-result, .search-result';
    const resultContainers = document.querySelectorAll(containerSelectors);
    
    const validNamesMap = new Map();
    
    console.log(`Found ${resultContainers.length} search result containers`);
    
    // Build valid names map from images and ghost entities
    const ghostSelectors = [
      '.EntityPhoto-circle-3-ghost-person .visually-hidden',
      '.ivm-view-attr__ghost-entity .visually-hidden',
      '.EntityPhoto-circle-3-ghost-person.ivm-view-attr__ghost-entity .visually-hidden'
    ];
    
    for (let container of resultContainers) {
      const img = container.querySelector('img[alt]');
      if (img && img.alt && img.alt.trim()) {
        let name = img.alt.trim().replace(/\s+(is\s+open\s+to\s+work|open\s+to\s+work).*$/i, '');
        validNamesMap.set(name.toLowerCase(), name);
      } else {
        for (let selector of ghostSelectors) {
          const ghostPerson = container.querySelector(selector);
          if (ghostPerson && ghostPerson.textContent.trim()) {
            let name = ghostPerson.textContent.trim().replace(/\s+(is\s+open\s+to\s+work|open\s+to\s+work).*$/i, '');
            validNamesMap.set(name.toLowerCase(), name);
            break;
          }
        }
        
        const profileLinks = container.querySelectorAll('a[href*="/in/"] span[aria-hidden="true"]');
        for (let link of profileLinks) {
          const text = link.textContent?.trim();
          if (text && text.length > 2 && text.length < 100 && 
              !text.toLowerCase().includes('view') && 
              !text.toLowerCase().includes('profile') &&
              !text.toLowerCase().includes('degree') &&
              !text.toLowerCase().includes('•')) {
            let name = text.replace(/\s+(is\s+open\s+to\s+work|open\s+to\s+work).*$/i, '');
            if (name && name.length > 2) {
              validNamesMap.set(name.toLowerCase(), name);
              break;
            }
          }
        }
      }
    }
    
    console.log(`Built valid names map with ${validNamesMap.size} entries`);
    
    // Extract profiles and match with valid names
    const profileLinks = document.querySelectorAll('a[href*="/in/"][href*="linkedin.com"]');
    console.log(`Found ${profileLinks.length} profile links`);
    
    const processedUrls = new Set();
    
    for (let link of profileLinks) {
      try {
        const href = link.getAttribute('href');
        if (!href || !href.includes('/in/')) continue;
        
        const profileUrl = href.split('?')[0].split('#')[0];
        if (processedUrls.has(profileUrl)) continue;
        processedUrls.add(profileUrl);
        
        let extractedName = this.findNameForProfile(link, profileUrl);
        if (!extractedName) continue;
        
        extractedName = extractedName.replace(/\s+(is\s+open\s+to\s+work|open\s+to\s+work).*$/i, '');
        
        const matchedValidName = this.findMatchingValidName(extractedName, validNamesMap);
        
        if (matchedValidName) {
          const mutualInfo = this.findMutualConnectionsInfo(link);
          
          let finalMutualInfo = mutualInfo;
          if (!finalMutualInfo) {
            for (let container of resultContainers) {
              const img = container.querySelector('img[alt]');
              const ghostPerson = container.querySelector('.EntityPhoto-circle-3-ghost-person .visually-hidden, .ivm-view-attr__ghost-entity .visually-hidden');
              const linkText = container.querySelector('a[href*="/in/"] span[aria-hidden="true"]');
              
              let containerName = '';
              if (img && img.alt.trim()) {
                containerName = img.alt.trim();
              } else if (ghostPerson && ghostPerson.textContent.trim()) {
                containerName = ghostPerson.textContent.trim();
              } else if (linkText && linkText.textContent.trim()) {
                containerName = linkText.textContent.trim();
              }
              
              if (containerName && containerName.toLowerCase() === matchedValidName.toLowerCase()) {
                finalMutualInfo = this.findMutualConnectionsForContainer(container);
                if (finalMutualInfo) {
                  break;
                }
              }
            }
          }
          
          profiles.push({ 
            name: matchedValidName,
            url: profileUrl,
            mutualConnections: finalMutualInfo || ''
          });
          
          console.log(`${matchedValidName} -> ${profileUrl} (${finalMutualInfo || 'No mutual connections'})`);
        }
        
      } catch (error) {
        continue;
      }
    }
    
    return profiles;
  }

  findMatchingValidName(extractedName, validNamesMap) {
    const extractedLower = extractedName.toLowerCase();
    
    if (validNamesMap.has(extractedLower)) {
      return validNamesMap.get(extractedLower);
    }
    
    for (let [validNameLower, validNameOriginal] of validNamesMap) {
      if (validNameLower.includes(extractedLower) || extractedLower.includes(validNameLower)) {
        return validNameOriginal;
      }
    }
    
    const extractedWords = extractedLower.split(/\s+/);
    
    for (let [validNameLower, validNameOriginal] of validNamesMap) {
      const validWords = validNameLower.split(/\s+/);
      
      let matchingWords = 0;
      for (let validWord of validWords) {
        if (validWord.length > 2 && extractedWords.some(ew => 
          ew.includes(validWord) || validWord.includes(ew)
        )) {
          matchingWords++;
        }
      }
      
      if (matchingWords >= Math.min(validWords.length, 2)) {
        return validNameOriginal;
      }
    }
    
    return null;
  }

  findNameForProfile(linkElement, profileUrl) {
    const container = linkElement.closest('div, li, article, section') || linkElement.parentElement;
    if (container) {
      const img = container.querySelector('img[alt]');
      if (img && img.alt && img.alt.trim() && !img.alt.toLowerCase().includes('photo')) {
        return img.alt.trim();
      }
      
      const ghostPerson = container.querySelector('.EntityPhoto-circle-3-ghost-person .visually-hidden, .ivm-view-attr__ghost-entity .visually-hidden');
      if (ghostPerson && ghostPerson.textContent.trim()) {
        return ghostPerson.textContent.trim();
      }
    }
    
    const linkText = linkElement.querySelector('span[aria-hidden="true"]');
    if (linkText && linkText.textContent.trim()) {
      const text = linkText.textContent.trim();
      if (text.length > 2 && text.length < 100 && 
          !text.toLowerCase().includes('view') && 
          !text.toLowerCase().includes('profile') &&
          !text.toLowerCase().includes('degree') &&
          !text.toLowerCase().includes('•')) {
        return text;
      }
    }
    
    const mutualContainer = container?.querySelector('.reusable-search-simple-insight__text-container');
    if (mutualContainer) {
      const mutualText = mutualContainer.textContent;
      const nameMatch = mutualText.match(/^([^,]+?)(?:\s+and\s|,|\s+are\s)/);
      if (nameMatch) {
        return nameMatch[1].trim();
      }
    }
    
    const strongElements = container?.querySelectorAll('strong, b');
    if (strongElements) {
      for (let strong of strongElements) {
        const text = strong.textContent.trim();
        if (text && text.length > 2 && text.length < 50 && !text.includes('other')) {
          return text;
        }
      }
    }
    
    const hiddenElements = container?.querySelectorAll('.visually-hidden');
    if (hiddenElements) {
      for (let hidden of hiddenElements) {
        const text = hidden.textContent.trim();
        if (text && text.length > 2 && text.length < 100 && 
            !text.toLowerCase().includes('button') && 
            !text.toLowerCase().includes('image') &&
            !text.toLowerCase().includes('icon') &&
            !text.toLowerCase().includes('view') &&
            !text.toLowerCase().includes('profile') &&
            !text.toLowerCase().includes('degree')) {
          return text;
        }
      }
    }
    
    const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
    if (urlMatch) {
      return urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim();
    }
    
    return null;
  }

  findMutualConnectionsInfo(linkElement) {
    const searchContainers = [
      linkElement.closest('[class*="entity-result"]'),
      linkElement.closest('[class*="reusable-search"]'),
      linkElement.closest('div, li, article, section'),
      linkElement.parentElement?.parentElement,
      linkElement.parentElement?.parentElement?.parentElement
    ];
    
    for (let container of searchContainers) {
      if (!container) continue;
      
      const mutualContainer = container.querySelector('.reusable-search-simple-insight__text-container');
      if (mutualContainer) {
        const rawText = mutualContainer.textContent.trim();
        
        const totalCount = this.parseMutualConnectionsCount(rawText);
        
        if (totalCount > 0) {
          return `${totalCount} mutual connections`;
        } else {
          return rawText;
        }
      }
    }
    
    return null;
  }

  findMutualConnectionsForContainer(resultContainer) {
    const mutualContainer = resultContainer.querySelector('.reusable-search-simple-insight__text-container');
    if (mutualContainer && mutualContainer.textContent.trim()) {
      const rawText = mutualContainer.textContent.trim();
      
      const totalCount = this.parseMutualConnectionsCount(rawText);
      
      if (totalCount > 0) {
        const result = `${totalCount} mutual connections`;
        return result;
      } else {
        return rawText;
      }
    }
    
    return null;
  }

  parseMutualConnectionsCount(text) {
    if (!text || typeof text !== 'string') return 0;
    
    let totalCount = 0;
    
    try {
      const lowerText = text.toLowerCase();
      
      const otherConnectionsMatch = lowerText.match(/(\d+)\s+other\s+mutual\s+connections?/);
      if (otherConnectionsMatch) {
        const otherCount = parseInt(otherConnectionsMatch[1], 10);
        totalCount += otherCount;
      }
      
      if (lowerText.includes('mutual')) {
        let namedCount = 0;
        
        if (otherConnectionsMatch) {
          const namesBeforeOtherMatch = text.match(/([^•]+?)\s+and\s+\d+\s+other/i);
          if (namesBeforeOtherMatch) {
            let namesText = namesBeforeOtherMatch[1].trim();
            
            const firstNameMatch = namesText.match(/([A-Z][^,]*(?:,\s*[A-Z][^,]*)*)/);
            if (firstNameMatch) {
              namesText = firstNameMatch[1];
            }
            
            const commasInNames = (namesText.match(/,/g) || []).length;
            namedCount = commasInNames + 1;
          }
        }
        else if (lowerText.includes('are mutual')) {
          const andMatches = (lowerText.match(/\s+and\s+/g) || []).length;
          if (andMatches > 0) {
            namedCount = andMatches + 1;
          }
        }
        else if (lowerText.includes('is a mutual') || lowerText.includes('is mutual')) {
          namedCount = 1;
        }
        
        totalCount += namedCount;
      }
      
      return totalCount;
      
    } catch (error) {
      console.error('Error parsing mutual connections:', error);
      return 0;
    }
  }

  extractFromConnectionsList() {
    const profiles = [];
    
    const profileListItems = document.querySelectorAll('div[data-view-name="connections-list"] > div');
    
    for (let item of profileListItems) {
      try {
        const linkElement = item.querySelector('a[data-view-name="connections-profile"]');
        if (!linkElement) continue;
        
        const profileUrl = linkElement.getAttribute('href').split('?')[0];
        
        let name = '';
        const nameSelectors = ['p', 'span[aria-hidden="true"]', 'p > a[href*="/in/"]'];
        
        for (let selector of nameSelectors) {
          const nameElement = item.querySelector(selector);
          if (nameElement && nameElement.textContent.trim()) {
            name = nameElement.textContent.trim();
            break;
          }
        }
        
        if (!name) {
          const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
          if (urlMatch) {
            name = urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim();
          }
        }
        
        if (name && profileUrl && !profiles.some(p => p.url === profileUrl)) {
          profiles.push({ name, url: profileUrl });
        }
      } catch (error) {
        continue;
      }
    }
    
    return profiles;
  }

  async extractConnectionsAlternative() {
    try {
      const profileDetails = [];
      
      const alternativeSelectors = [
        'div[data-view-name="connections-list"] > div',
        'li.reusable-search__entity-result',
        '.search-result__info .search-result__result-link',
        '.entity-result__title-text a',
        '.search-result__title a',
        '.reusable-search__result-container a[href*="/in/"]'
      ];
      
      for (let selector of alternativeSelectors) {
        const elements = document.querySelectorAll(selector);
        console.log(`Trying alternative selector "${selector}": found ${elements.length} elements`);
        
        if (elements.length > 0) {
          for (let element of elements) {
            try {
              let profileUrl, name;
              
              if (selector === 'div[data-view-name="connections-list"] > div') {
                const linkElement = element.querySelector('a[data-view-name="connections-profile"]');
                const nameElement = element.querySelector('p > a[href*="/in/"]');
                if (linkElement && nameElement) {
                  profileUrl = linkElement.getAttribute('href').split('?')[0];
                  name = nameElement.textContent.trim();
                }
              } else if (selector === 'li.reusable-search__entity-result') {
                const linkElement = element.querySelector("a.app-aware-link");
                if (linkElement) {
                  profileUrl = linkElement.getAttribute('href').split('?')[0];
                  const nameElement = linkElement.querySelector('span[dir="ltr"] span[aria-hidden="true"]');
                  if (nameElement) {
                    name = nameElement.textContent.trim();
                  }
                }
              } else {
                profileUrl = element.getAttribute('href')?.split('?')[0];
                name = element.textContent.trim() || element.querySelector('span')?.textContent?.trim();
              }
              
              if (name && profileUrl && !profileDetails.some(p => p.url === profileUrl)) {
                profileDetails.push({ name, url: profileUrl });
              }
            } catch (error) {
              continue;
            }
          }
          
          if (profileDetails.length > 0) {
            console.log(`Success with alternative selector "${selector}": extracted ${profileDetails.length} profiles`);
            break;
          }
        }
      }
      
      return profileDetails;
    } catch (error) {
      console.error('Error in alternative extraction:', error);
      return [];
    }
  }

  // =============================================
  // PAGE NAVIGATION COMMANDS
  // =============================================

  getCurrentPageInfo() {
    const currentPage = this.getCurrentPageNumber();
    const maxPage = this.getMaxPageNumber();
    
    return {
      success: true,
      currentPage: currentPage,
      maxPage: maxPage,
      url: window.location.href
    };
  }

  getCurrentPageNumber() {
    const currentPageElement = document.querySelector('.artdeco-pagination__indicator.active button span, .artdeco-pagination__page-state');
    
    if (currentPageElement) {
      const match = currentPageElement.textContent.match(/(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const pageParam = urlParams.get('page');
    if (pageParam) {
      return parseInt(pageParam, 10);
    }
    
    return 1;
  }

  getMaxPageNumber() {
    const pageStateElement = document.querySelector('.artdeco-pagination__page-state');
    if (pageStateElement) {
      const match = pageStateElement.textContent.match(/Page\s+\d+\s+of\s+(\d+)/i);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    
    const lastPageButton = document.querySelector('.artdeco-pagination__pages button:last-child span');
    if (lastPageButton) {
      const lastPageNum = parseInt(lastPageButton.textContent, 10);
      if (!isNaN(lastPageNum)) {
        return lastPageNum;
      }
    }
    
    return null;
  }

  isLastPage() {
    const nextButton = document.querySelector('button[aria-label="Next"], .artdeco-pagination__button--next');
    const isDisabled = nextButton && (nextButton.disabled || nextButton.classList.contains('artdeco-button--disabled'));
    
    const currentPage = this.getCurrentPageNumber();
    const maxPage = this.getMaxPageNumber();
    const isMaxPage = maxPage && currentPage >= maxPage;
    
    return {
      success: true,
      isLastPage: isDisabled || isMaxPage,
      currentPage: currentPage,
      maxPage: maxPage
    };
  }

  async waitForPageReady() {
    const maxWait = 5000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const connections = document.querySelectorAll('a[href*="/in/"]');
      if (connections.length > 0 && document.readyState === 'complete') {
        await this.delay(200); // Small buffer
        return { success: true, connectionsFound: connections.length };
      }
      await this.delay(300);
    }
    
    return { success: false, error: 'Page ready timeout' };
  }

  // =============================================
  // USER INTERACTION COMMANDS
  // =============================================

  async clickNextButton() {
    console.log('Attempting to click Next button');
    
    await this.delay(300);
    
    const nextSelectors = [
      'button[aria-label="Next"]:not([disabled])',
      '.artdeco-pagination__button--next:not([disabled])',
      '.artdeco-pagination button:last-child:not([disabled])'
    ];
    
    let nextButton = null;
    
    for (let selector of nextSelectors) {
      nextButton = document.querySelector(selector);
      if (nextButton && !nextButton.disabled && !nextButton.classList.contains('artdeco-button--disabled')) {
        break;
      }
      nextButton = null;
    }
    
    if (!nextButton) {
      const xpath = "//button[contains(text(), 'Next') and not(@disabled)]";
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      nextButton = result.singleNodeValue;
    }
    
    if (!nextButton || nextButton.disabled || nextButton.classList.contains('artdeco-button--disabled')) {
      console.log('Next button not found or disabled');
      return { success: false, error: 'Next button not available' };
    }
    
    console.log('Clicking Next button...');
    await this.humanClick(nextButton);
    await this.delay(800);
    
    return { success: true, message: 'Next button clicked' };
  }

  async realisticScroll() {
    console.log('Performing realistic scroll');
    
    const scrollBehaviors = [
      { type: 'quick', weight: 0.1 },
      { type: 'browse', weight: 0.8 },
      { type: 'backtrack', weight: 0.1 }
    ];
    
    const behavior = this.weightedChoice(scrollBehaviors);
    
    try {
      switch (behavior) {
        case 'quick':
          await this.quickScrollToBottom();
          break;
        case 'browse':
          await this.browsingScrollPattern();
          break;
        case 'backtrack':
          await this.backtrackScrollPattern();
          break;
      }
      
      return { success: true, scrollType: behavior };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async quickScrollToBottom() {
    const totalHeight = document.body.scrollHeight;
    const viewHeight = window.innerHeight;
    const scrollAmount = totalHeight - viewHeight;
    
    const steps = 4;
    const stepSize = scrollAmount / steps;
    
    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, stepSize);
      await this.delay(50);
    }
    
    await this.delay(300);
  }

  async browsingScrollPattern() {
    const scrollCount = 3 + Math.floor(Math.random() * 4);
    const totalHeight = document.body.scrollHeight;
    const viewHeight = window.innerHeight;
    const maxScroll = totalHeight - viewHeight;
    
    let currentScroll = 0;
    
    for (let i = 0; i < scrollCount && currentScroll < maxScroll; i++) {
      const scrollAmount = 200 + Math.random() * 400;
      const actualScroll = Math.min(scrollAmount, maxScroll - currentScroll);
      
      await this.humanScroll('down', actualScroll);
      currentScroll += actualScroll;
      
      const readingTime = 200 + Math.random() * 400;
      await this.delay(readingTime);
      
      if (currentScroll >= maxScroll) break;
    }
  }

  async backtrackScrollPattern() {
    await this.browsingScrollPattern();
    
    await this.delay(300);
    const backtrackAmount = 150 + Math.random() * 250;
    await this.humanScroll('up', backtrackAmount);
    await this.delay(500);
    
    const remainingHeight = document.body.scrollHeight - window.innerHeight - window.pageYOffset;
    if (remainingHeight > 100) {
      await this.humanScroll('down', remainingHeight);
    }
  }

  weightedChoice(choices) {
    const totalWeight = choices.reduce((sum, choice) => sum + choice.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (let choice of choices) {
      random -= choice.weight;
      if (random <= 0) {
        return choice.type;
      }
    }
    
    return choices[0].type;
  }

  async humanClick(element) {
    if (!this.isInViewport(element)) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.delay(500 + Math.random() * 500);
    }
    
    const rect = element.getBoundingClientRect();
    const clickX = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    const clickY = rect.top + rect.height * (0.3 + Math.random() * 0.4);
    
    await this.moveToElement(element);
    
    const events = [
      { type: 'mouseover', delay: 0 },
      { type: 'mouseenter', delay: 20 + Math.random() * 30 },
      { type: 'mousemove', delay: 50 + Math.random() * 100 },
      { type: 'mousedown', delay: 100 + Math.random() * 200 },
      { type: 'focus', delay: 10 + Math.random() * 20 },
      { type: 'mouseup', delay: 80 + Math.random() * 120 },
      { type: 'click', delay: 10 + Math.random() * 20 }
    ];
    
    for (const { type, delay } of events) {
      await this.delay(delay);
      
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: clickX,
        clientY: clickY,
        button: 0,
        buttons: type === 'mousedown' ? 1 : 0
      });
      
      element.dispatchEvent(event);
    }
  }

  async moveToElement(targetElement) {
    const target = targetElement.getBoundingClientRect();
    const targetX = target.left + target.width * (0.3 + Math.random() * 0.4);
    const targetY = target.top + target.height * (0.3 + Math.random() * 0.4);
    
    const startX = this.currentPosition.x;
    const startY = this.currentPosition.y;
    
    await this.humanMovement(startX, startY, targetX, targetY);
    this.currentPosition = { x: targetX, y: targetY };
  }

  async humanMovement(startX, startY, endX, endY) {
    const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
    const duration = Math.max(200, Math.min(1000, distance * 1.5));
    const steps = Math.ceil(duration / 16);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const easeT = this.easeOutCubic(t);
      
      const x = startX + (endX - startX) * easeT;
      const y = startY + (endY - startY) * easeT;
      
      this.dispatchMouseMove(x, y);
      await this.delay(16);
    }
  }

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  dispatchMouseMove(x, y) {
    const event = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons: 0
    });
    document.dispatchEvent(event);
  }

  async humanScroll(direction = 'down', amount = null) {
    const scrollAmount = amount || (300 + Math.random() * 400);
    const steps = 6 + Math.floor(Math.random() * 5);
    const stepSize = scrollAmount / steps;
    
    for (let i = 0; i < steps; i++) {
      const variance = 0.8 + Math.random() * 0.4;
      const currentStep = stepSize * variance;
      
      window.scrollBy(0, direction === 'down' ? currentStep : -currentStep);
      await this.delay(40 + Math.random() * 60);
    }
    
    await this.delay(200 + Math.random() * 400);
  }

  // =============================================
  // PROFILE ANALYSIS COMMANDS
  // =============================================

  findConnectionsUrlFromProfile() {
    try {
      console.log('Finding connections URL from profile page');
      console.log('Current URL:', window.location.href);
      console.log('Page title:', document.title);
      
      // Get profile name
      let profileName = null;
      const nameSelectors = [
        'h1.text-heading-xlarge',
        'h1[data-generated-suggestion-target]',
        '.pv-text-details__left-panel h1',
        'h1.break-words',
        '.mt2.relative h1'
      ];
      
      for (let selector of nameSelectors) {
        const nameElement = document.querySelector(selector);
        if (nameElement && nameElement.textContent.trim()) {
          profileName = nameElement.textContent.trim();
          console.log(`Found profile name: "${profileName}"`);
          break;
        }
      }
      
      // Find connections link
      let connectionsLink = null;
      
      // Method 1: Look for links containing "connections" text
      const allLinks = document.querySelectorAll('a[href*="search/results/people"]');
      console.log(`Found ${allLinks.length} potential connection search links`);
      
      for (let link of allLinks) {
        const linkText = link.textContent.toLowerCase();
        const href = link.getAttribute('href');
        
        if (linkText.includes('connection') && href.includes('connectionOf')) {
          connectionsLink = href;
          console.log(`Found connections link: ${connectionsLink}`);
          break;
        }
      }
      
      // Method 2: Look for specific URL patterns
      if (!connectionsLink) {
        const connectionUrlSelectors = [
          'a[href*="connectionOf"][href*="search/results/people"]',
          'a[href*="network=%5B%22F%22%2C%22S%22%5D"]'
        ];
        
        for (let selector of connectionUrlSelectors) {
          const linkElement = document.querySelector(selector);
          if (linkElement) {
            connectionsLink = linkElement.getAttribute('href');
            console.log(`Found connections link via selector: ${connectionsLink}`);
            break;
          }
        }
      }
      
      if (!connectionsLink) {
        console.log('No connections link found');
        return { 
          success: false, 
          error: 'Could not find connections link. Make sure the profile has visible connections.' 
        };
      }
      
      // Clean up the URL
      if (connectionsLink.startsWith('/')) {
        connectionsLink = 'https://www.linkedin.com' + connectionsLink;
      }
      connectionsLink = connectionsLink.replace(/&amp;/g, '&');
      
      console.log(`Final connections URL: ${connectionsLink}`);
      console.log(`Profile name: ${profileName || 'Unknown'}`);
      
      return {
        success: true,
        connectionsUrl: connectionsLink,
        profileName: profileName
      };
      
    } catch (error) {
      console.error('Error finding connections URL:', error);
      return { 
        success: false, 
        error: `Error extracting connections link: ${error.message}` 
      };
    }
  }

  findSourceConnectionFromPage() {
    const filterPill = document.querySelector('button[id="searchFilter_connectionOf"]');
    if (filterPill && filterPill.textContent.trim()) {
      const name = filterPill.textContent.trim();
      if (name && !name.includes('Connections of')) {
        return name;
      }
    }
    
    const filterLabel = document.querySelector('.search-reusables__value-label .t-14.t-black--light.t-normal[aria-hidden="true"]');
    if (filterLabel && filterLabel.textContent.trim()) {
      return filterLabel.textContent.trim();
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const connectionOfParam = urlParams.get('facetConnectionOf');
    if (connectionOfParam) {
      return decodeURIComponent(connectionOfParam);
    }
    
    return null;
  }

  // =============================================
  // UTILITY METHODS
  // =============================================

  debugCurrentPage() {
    const debugInfo = {
      url: window.location.href,
      title: document.title,
      profileLinks: document.querySelectorAll('a[href*="/in/"]').length,
      searchResults: document.querySelectorAll('.reusable-search__entity-result').length,
      connectionCards: document.querySelectorAll('.mn-connection-card').length,
      isConnectionsPage: this.isConnectionsPage(),
      isSearchPage: this.isSearchResultsPage(),
      sourceConnection: this.findSourceConnectionFromPage(),
      currentPage: this.getCurrentPageNumber(),
      maxPage: this.getMaxPageNumber(),
      isLastPage: this.isLastPage().isLastPage
    };
    
    console.table(debugInfo);
    return { success: true, data: debugInfo };
  }

  isConnectionsPage() {
    return window.location.href.includes('/mynetwork/invite-connect/connections/') ||
           (window.location.href.startsWith('file://') && 
            (document.title.toLowerCase().includes('connections') ||
             document.querySelector('div[data-view-name="connections-list"]')));
  }

  isSearchResultsPage() {
    return window.location.href.includes('/search/results/people/') ||
           (window.location.href.startsWith('file://') && 
            (document.querySelector('.reusable-search__entity-result-list') ||
             document.querySelector('li.reusable-search__entity-result')));
  }

  hasSearchResults() {
    return document.querySelector('a[href*="/in/"][href*="linkedin.com"]') !== null ||
           document.querySelector('.reusable-search-simple-insight__text-container') !== null ||
           document.querySelector('img[alt]') !== null;
  }

  isPageReady() {
    return document.readyState === 'complete' && 
           document.querySelectorAll('a[href*="/in/"]').length > 0;
  }

  isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
  }

  storeDataLocally(data, sourceConnection, pageType) {
    try {
      window.lastExtractedData = {
        data: data,
        sourceConnection: sourceConnection,
        pageType: pageType,
        timestamp: new Date().toISOString()
      };
      console.log(`Stored ${data.length} profiles locally`);
      return true;
    } catch (error) {
      console.error('Failed to store data locally:', error);
      return false;
    }
  }

  showNotification(message, type = 'info') {
    if (!this.showNotifications) return;
    
    const notification = document.createElement('div');
    const notificationId = Date.now() + Math.random();
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)' : 
                   type === 'error' ? 'linear-gradient(135deg, #3a1a1a 0%, #2a1010 100%)' : 
                   'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)'};
      color: ${type === 'success' ? '#4ade80' : type === 'error' ? '#ef4444' : '#ffffff'};
      border: 1px solid ${type === 'success' ? 'rgba(74, 222, 128, 0.2)' : 
                          type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 
                          'rgba(255, 255, 255, 0.1)'};
      padding: 12px 20px;
      border-radius: 8px;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      backdrop-filter: blur(8px);
    `;
    notification.textContent = message;
    notification.dataset.notificationId = notificationId;
    
    document.body.appendChild(notification);
    this.activeNotifications.add(notificationId);
    
    setTimeout(() => {
      this.removeNotification(notificationId);
    }, 4000);
  }

  removeNotification(notificationId) {
    try {
      const notification = document.querySelector(`[data-notification-id="${notificationId}"]`);
      if (notification && notification.parentNode) {
        notification.parentNode.removeChild(notification);
        this.activeNotifications.delete(notificationId);
      }
    } catch (error) {
      this.activeNotifications.delete(notificationId);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Initialize the hand
const scraperHand = new LinkedInScraperHand();