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
            headline: profile.headline || '',
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

      // Method 1 (2026 structure): Use figure[aria-label] to find connection cards
      // LinkedIn now uses hashed class names, so we rely on aria-label and structural selectors
      const figures = document.querySelectorAll('figure[aria-label*="profile picture"]');
      console.log(`Found ${figures.length} profile picture figures (new structure)`);

      if (figures.length > 0) {
        for (let figure of figures) {
          try {
            // Extract name from aria-label: "Betsy Yang's profile picture" -> "Betsy Yang"
            const ariaLabel = figure.getAttribute('aria-label') || '';
            let name = ariaLabel.replace(/'s profile picture$/i, '').trim();

            // Walk up to find the card container (the div with componentkey="auto-component-...")
            let card = figure.closest('div[componentkey^="auto-component-"]');
            if (!card) {
              // Fallback: walk up a few levels to find a container with a profile link
              card = figure.closest('div');
              while (card && !card.querySelector('a[href*="/in/"]')) {
                card = card.parentElement;
                if (!card || card === document.body) { card = null; break; }
              }
            }
            if (!card) continue;

            // Find the profile URL: prefer the <a> wrapping the figure (always this person),
            // falling back to the first /in/ link in the card.
            let profileUrl = null;
            const figureLink = figure.closest('a[href*="/in/"]');
            if (figureLink) {
              try {
                profileUrl = new URL(figureLink.href, 'https://www.linkedin.com').pathname;
              } catch {
                profileUrl = figureLink.getAttribute('href').split('?')[0].split('#')[0];
              }
            }
            if (!profileUrl) {
              const profileLinks = card.querySelectorAll('a[href*="/in/"]');
              for (let link of profileLinks) {
                const href = link.getAttribute('href');
                if (href && href.includes('/in/')) {
                  try {
                    profileUrl = new URL(href, 'https://www.linkedin.com').pathname;
                  } catch {
                    profileUrl = href.split('?')[0].split('#')[0];
                  }
                  break;
                }
              }
            }
            if (!profileUrl) continue;
            if (seenUrls.has(profileUrl)) continue;
            seenUrls.add(profileUrl);

            // If name wasn't found from aria-label, try text content of bold <p> elements
            if (!name) {
              const boldParagraphs = card.querySelectorAll('p');
              for (let p of boldParagraphs) {
                const text = p.textContent.trim();
                // The name paragraph is typically short and doesn't contain "Connected on" or job titles
                if (text && text.length > 1 && text.length < 60 &&
                    !text.includes('Connected on') && !text.includes('|') &&
                    !text.includes('&') && !text.includes('@')) {
                  name = text;
                  break;
                }
              }
            }

            // Last resort: extract from URL
            if (!name) {
              const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
              if (urlMatch) {
                name = urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim()
                  .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              }
            }

            if (name && profileUrl) {
              const fullUrl = profileUrl.startsWith('http') ? profileUrl : 'https://www.linkedin.com' + profileUrl;
              const headline = this.findHeadline(card, name);
              connectionDetails.push({ name, url: fullUrl, headline });
            }
          } catch (error) {
            continue;
          }
        }
      }

      // Method 2: Legacy selectors (pre-2026 LinkedIn structure)
      if (connectionDetails.length === 0) {
        const liveSelectors = '.mn-connection-card__details, .mn-connection-card, [data-view-name="connection-card"], .artdeco-entity-lockup';
        const liveCards = document.querySelectorAll(liveSelectors);
        console.log(`Found ${liveCards.length} legacy connection cards`);

        for (let card of liveCards) {
          try {
            const linkElement = card.querySelector('a[href*="/in/"]');
            if (!linkElement) continue;

            const profileUrl = linkElement.getAttribute('href').split('?')[0];
            if (seenUrls.has(profileUrl)) continue;
            seenUrls.add(profileUrl);

            let name = '';
            const nameSelectors = [
              '.mn-connection-card__name',
              '.artdeco-entity-lockup__title a',
              '.t-16.t-black.t-bold',
              'span[aria-hidden="true"]:not(.visually-hidden)',
              'span.t-bold'
            ];
            for (let selector of nameSelectors) {
              const nameElement = card.querySelector(selector);
              if (nameElement && nameElement.textContent.trim()) {
                name = nameElement.textContent.trim();
                break;
              }
            }

            if (name && profileUrl) {
              const headline = this.findHeadline(card, name);
              connectionDetails.push({ name, url: profileUrl, headline });
            }
          } catch (error) {
            continue;
          }
        }
      }

      // Method 3: Generic fallback - find all profile links and deduplicate
      if (connectionDetails.length === 0) {
        const allProfileLinks = document.querySelectorAll('a[href*="/in/"]');
        console.log(`Fallback: found ${allProfileLinks.length} profile links`);

        for (let link of allProfileLinks) {
          try {
            const href = link.getAttribute('href');
            if (!href || !href.includes('/in/')) continue;

            let profileUrl;
            try {
              profileUrl = new URL(href, 'https://www.linkedin.com').pathname;
            } catch {
              profileUrl = href.split('?')[0];
            }
            if (seenUrls.has(profileUrl)) continue;
            seenUrls.add(profileUrl);

            // Try to get name from nearby figure, img alt, or text content
            let name = '';
            const container = link.closest('div[componentkey]') || link.parentElement?.parentElement;
            if (container) {
              const fig = container.querySelector('figure[aria-label]');
              if (fig) {
                name = (fig.getAttribute('aria-label') || '').replace(/'s profile picture$/i, '').trim();
              }
              if (!name) {
                const img = container.querySelector('img[alt]');
                if (img && img.alt && !img.alt.toLowerCase().includes('linkedin')) {
                  name = img.alt.replace(/'s profile picture$/i, '').trim();
                }
              }
            }
            if (!name) {
              const linkText = link.textContent.trim();
              if (linkText && linkText.length > 1 && linkText.length < 60) {
                name = linkText;
              }
            }
            if (!name) {
              const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
              if (urlMatch) {
                name = urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim()
                  .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              }
            }

            if (name && profileUrl) {
              const fullUrl = profileUrl.startsWith('http') ? profileUrl : 'https://www.linkedin.com' + profileUrl;
              const headline = container ? this.findHeadline(container, name) : '';
              connectionDetails.push({ name, url: fullUrl, headline });
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
    const processedUrls = new Set();

    // Strategy 1 (2026): Search results use div[role="listitem"] inside div[role="list"]
    // Each listitem is wrapped in a parent <a href="/in/..."> tag
    const listItems = document.querySelectorAll('div[role="listitem"]');
    console.log(`Found ${listItems.length} listitem cards (2026 structure)`);

    if (listItems.length > 0) {
      for (let card of listItems) {
        try {
          // Get name from figure[aria-label] first
          let name = '';
          const fig = card.querySelector('figure[aria-label]');
          if (fig) {
            const label = fig.getAttribute('aria-label') || '';
            name = label.replace(/'s profile picture$/i, '').trim();
          }

          // Anchor URL to the <a> wrapping the figure (guaranteed to be this person's profile).
          // Fall back to the card's ancestor <a> only if the figure has no direct link.
          let profileUrl;
          const figureLink = fig ? fig.closest('a[href*="/in/"]') : null;
          if (figureLink) {
            try {
              profileUrl = new URL(figureLink.href).pathname;
            } catch {
              profileUrl = figureLink.getAttribute('href').split('?')[0];
            }
          } else {
            const parentLink = card.closest('a[href*="/in/"]');
            if (!parentLink) continue;
            try {
              profileUrl = new URL(parentLink.href).pathname;
            } catch {
              profileUrl = parentLink.getAttribute('href').split('?')[0];
            }
          }
          if (!profileUrl || !profileUrl.includes('/in/')) continue;
          if (processedUrls.has(profileUrl)) continue;
          processedUrls.add(profileUrl);
          // Fallback: img alt
          if (!name) {
            const img = card.querySelector('img[alt]');
            if (img && img.alt && img.alt.length > 1 && !img.alt.toLowerCase().includes('linkedin')) {
              name = img.alt.replace(/'s profile picture$/i, '').trim();
            }
          }
          // Fallback: first <a> inside the card with text that looks like a name
          if (!name) {
            const nameLinks = card.querySelectorAll('a[href*="/in/"]');
            for (let nl of nameLinks) {
              const text = nl.textContent.trim();
              if (text && text.length > 1 && text.length < 60 && !text.includes('Connect') && !text.includes('mutual')) {
                name = text;
                break;
              }
            }
          }
          if (!name) continue;

          // Get mutual connections from the card or parent link context
          // Mutual info is in <strong> tags: "Name1", "Name2" and "N other mutual connections"
          const mutualConnections = this.findMutualConnectionsInfoNew(parentLink);
          const headline = this.findHeadline(card, name);

          const fullUrl = profileUrl.startsWith('http') ? profileUrl : 'https://www.linkedin.com' + profileUrl;
          profiles.push({ name, url: fullUrl, mutualConnections, headline });

          console.log(`${name} -> ${fullUrl} | ${headline || 'No headline'} (${mutualConnections || 'No mutual connections'})`);
        } catch (error) {
          continue;
        }
      }
    }

    // Strategy 2: data-view-name selectors (older structure)
    if (profiles.length === 0) {
      const resultContainers = document.querySelectorAll('div[data-view-name="people-search-result"]');
      console.log(`Found ${resultContainers.length} search result containers (data-view-name)`);

      for (let card of resultContainers) {
        try {
          const linkElement = card.querySelector('a[data-view-name="search-result-lockup-title"]') ||
                              card.querySelector('a[href*="/in/"]');
          if (!linkElement) continue;

          let profileUrl;
          try { profileUrl = new URL(linkElement.href).pathname; }
          catch { profileUrl = linkElement.getAttribute('href').split('?')[0]; }
          if (processedUrls.has(profileUrl)) continue;
          processedUrls.add(profileUrl);

          let name = '';
          const img = card.querySelector('img[alt]');
          if (img && img.alt && !img.alt.toLowerCase().includes('linkedin')) {
            name = img.alt.replace(/'s profile picture$/i, '').trim();
          }
          if (!name) {
            const fig = card.querySelector('figure[aria-label]');
            if (fig) name = (fig.getAttribute('aria-label') || '').replace(/'s profile picture$/i, '').trim();
          }
          if (!name && linkElement.textContent) {
            name = linkElement.textContent.trim().replace(/•.*/, '').trim();
          }
          if (!name) continue;

          const mutualConnections = this.findMutualConnectionsInfoNew(card);
          const headline = this.findHeadline(card, name);
          const fullUrl = profileUrl.startsWith('http') ? profileUrl : 'https://www.linkedin.com' + profileUrl;
          profiles.push({ name, url: fullUrl, mutualConnections, headline });
        } catch (error) { continue; }
      }
    }

    // Strategy 3: Legacy reusable-search selectors
    if (profiles.length === 0) {
      const legacyCards = document.querySelectorAll('li.reusable-search__entity-result, .entity-result, [data-entity-urn]');
      console.log(`Found ${legacyCards.length} legacy search result cards`);

      for (let card of legacyCards) {
        try {
          const linkElement = card.querySelector('a[href*="/in/"]');
          if (!linkElement) continue;

          let profileUrl;
          try { profileUrl = new URL(linkElement.href).pathname; }
          catch { profileUrl = linkElement.getAttribute('href').split('?')[0]; }
          if (processedUrls.has(profileUrl)) continue;
          processedUrls.add(profileUrl);

          let name = '';
          for (let sel of ['span[dir="ltr"] span[aria-hidden="true"]', '.entity-result__title-text span[aria-hidden="true"]', 'span.t-bold']) {
            const el = card.querySelector(sel);
            if (el && el.textContent.trim()) { name = el.textContent.trim(); break; }
          }
          if (!name) {
            const img = card.querySelector('img[alt]');
            if (img && img.alt) name = img.alt.replace(/'s profile picture$/i, '').trim();
          }
          if (!name) continue;

          const mutualConnections = this.findMutualConnectionsForContainer(card) || '';
          const headline = this.findHeadline(card, name);
          const fullUrl = profileUrl.startsWith('http') ? profileUrl : 'https://www.linkedin.com' + profileUrl;
          profiles.push({ name, url: fullUrl, mutualConnections, headline });
        } catch (error) { continue; }
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

  // Extract the headline/description text from a card (e.g., "Founder at Bleecker Street")
  findHeadline(card, personName) {
    if (!card) return '';

    const normalizedName = (personName || '').toLowerCase().trim();

    const isHeadlineCandidate = (el, text) => {
      if (!text || text.length < 3 || text.length > 220) return false;
      const lower = text.toLowerCase();
      // Skip the person's own name
      if (normalizedName && lower === normalizedName) return false;
      // Skip elements inside <figure> (avatar area)
      if (el.closest('figure')) return false;
      // Skip aria-hidden spans (often used for visually-hidden name duplicates)
      if (el.getAttribute('aria-hidden') === 'true') return false;
      // Skip "Connected on..." text
      if (lower.startsWith('connected on')) return false;
      // Skip degree indicators like "• 2nd"
      if (/^[•·]\s*\d+(st|nd|rd|th)\+?$/.test(text)) return false;
      // Skip mutual connections text
      if (lower.includes('mutual connection') || lower.includes('mutual')) return false;
      // Skip button labels
      if (['connect', 'message', 'follow', 'pending'].includes(lower)) return false;
      // Skip followers count
      if (lower.includes('follower')) return false;
      return true;
    };

    // Try <p> elements first (older LinkedIn structure used <p> for headlines)
    for (let p of card.querySelectorAll('p')) {
      if (p.querySelector('a[href*="/in/"]')) continue; // skip name paragraphs
      const text = p.textContent.trim();
      if (isHeadlineCandidate(p, text)) return text;
    }

    // Fallback: try leaf <span> elements (LinkedIn 2026 structure uses spans)
    for (let span of card.querySelectorAll('span')) {
      if (span.querySelector('span')) continue; // only leaf spans to avoid duplicated text
      const text = span.textContent.trim();
      if (isHeadlineCandidate(span, text)) return text;
    }

    return '';
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

  // Helper function for updated LinkedIn structure - finds mutual connections text
  findMutualConnectionsInfoNew(card) {
    // Strategy 1 (2026): Look for <strong> tags containing "mutual connections"
    // The new structure uses: <strong>Name1</strong>, <strong>Name2</strong> and <strong>N other mutual connections</strong>
    const strongElements = card.querySelectorAll('strong');
    for (let strong of strongElements) {
      const text = strong.textContent.trim().toLowerCase();
      if (text.includes('mutual connection')) {
        // Found the "N other mutual connections" strong tag - get the full paragraph
        const parentP = strong.closest('p');
        if (parentP) {
          return parentP.textContent.trim().replace(/\s\s+/g, ' ');
        }
        return strong.textContent.trim();
      }
    }

    // Strategy 2: Look for any <p> or <a> text containing "mutual"
    const allParagraphs = card.querySelectorAll('p');
    for (let p of allParagraphs) {
      const text = p.textContent.trim();
      if (text.toLowerCase().includes('mutual') && text.length < 200) {
        return text.replace(/\s\s+/g, ' ');
      }
    }

    // Strategy 3: Look for any span containing "mutual"
    const allSpans = card.querySelectorAll('span');
    for (let span of allSpans) {
      const text = span.textContent.trim();
      if (text.toLowerCase().includes('mutual') && text.length < 200) {
        return text.replace(/\s\s+/g, ' ');
      }
    }

    // Strategy 4: Hashed class selector (fragile, may break)
    const mutualInsightContainer = card.querySelector('div.ab54df51');
    if (mutualInsightContainer) {
      const textElement = mutualInsightContainer.querySelector('p');
      if (textElement) {
        return textElement.textContent.trim().replace(/\s\s+/g, ' ');
      }
    }

    // Strategy 5: Legacy selector
    const legacyContainer = card.querySelector('.reusable-search-simple-insight__text-container');
    if (legacyContainer) {
      return legacyContainer.textContent.trim().replace(/\s\s+/g, ' ');
    }

    return '';
  }

  extractFromConnectionsList() {
    const profiles = [];
    const seenUrls = new Set();

    // New 2026 structure: cards identified by componentkey and figure aria-labels
    const figures = document.querySelectorAll('figure[aria-label*="profile picture"]');
    console.log(`extractFromConnectionsList: found ${figures.length} figures`);

    for (let figure of figures) {
      try {
        const name = (figure.getAttribute('aria-label') || '').replace(/'s profile picture$/i, '').trim();
        if (!name) continue;

        // Anchor URL to the <a> wrapping the figure (always this person's profile).
        let profileUrl = null;
        const figureLink = figure.closest('a[href*="/in/"]');
        if (figureLink) {
          try {
            profileUrl = new URL(figureLink.href, 'https://www.linkedin.com').pathname;
          } catch {
            profileUrl = figureLink.getAttribute('href').split('?')[0];
          }
        }
        if (!profileUrl) {
          const card = figure.closest('div[componentkey^="auto-component-"]') || figure.closest('div');
          if (!card) continue;
          const linkElement = card.querySelector('a[href*="/in/"]');
          if (!linkElement) continue;
          try {
            profileUrl = new URL(linkElement.href, 'https://www.linkedin.com').pathname;
          } catch {
            profileUrl = linkElement.getAttribute('href').split('?')[0];
          }
        }
        if (!profileUrl) continue;

        if (seenUrls.has(profileUrl)) continue;
        seenUrls.add(profileUrl);

        const card = figure.closest('div[componentkey^="auto-component-"]') || figure.closest('div');
        const fullUrl = profileUrl.startsWith('http') ? profileUrl : 'https://www.linkedin.com' + profileUrl;
        const headline = card ? this.findHeadline(card, name) : '';
        profiles.push({ name, url: fullUrl, headline });
      } catch (error) {
        continue;
      }
    }

    // Legacy fallback
    if (profiles.length === 0) {
      const profileListItems = document.querySelectorAll('div[data-view-name="connections-list"] > div');
      for (let item of profileListItems) {
        try {
          const linkElement = item.querySelector('a[data-view-name="connections-profile"]');
          if (!linkElement) continue;
          const profileUrl = linkElement.getAttribute('href').split('?')[0];
          if (seenUrls.has(profileUrl)) continue;
          seenUrls.add(profileUrl);

          let name = '';
          for (let selector of ['p', 'span[aria-hidden="true"]']) {
            const el = item.querySelector(selector);
            if (el && el.textContent.trim()) { name = el.textContent.trim(); break; }
          }
          if (!name) {
            const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
            if (urlMatch) name = urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim();
          }
          if (name && profileUrl) profiles.push({ name, url: profileUrl });
        } catch (error) { continue; }
      }
    }

    return profiles;
  }

  async extractConnectionsAlternative() {
    try {
      const profileDetails = [];
      const seenUrls = new Set();

      // Strategy 1 (2026): Scan all profile links and use figure/img for names
      const allProfileLinks = document.querySelectorAll('a[href*="/in/"]');
      console.log(`Alternative extraction: found ${allProfileLinks.length} profile links`);

      for (let link of allProfileLinks) {
        try {
          const href = link.getAttribute('href');
          if (!href || !href.includes('/in/')) continue;

          let profileUrl;
          try {
            profileUrl = new URL(href, 'https://www.linkedin.com').pathname;
          } catch {
            profileUrl = href.split('?')[0];
          }
          if (seenUrls.has(profileUrl)) continue;
          seenUrls.add(profileUrl);

          let name = '';

          // Walk up to find a card container
          const card = link.closest('div[componentkey^="auto-component-"]') ||
                       link.closest('li') ||
                       link.closest('div[componentkey]') ||
                       link.parentElement?.parentElement?.parentElement;

          if (card) {
            // Try figure aria-label
            const fig = card.querySelector('figure[aria-label]');
            if (fig) {
              name = (fig.getAttribute('aria-label') || '').replace(/'s profile picture$/i, '').trim();
            }
            // Try img alt
            if (!name) {
              const img = card.querySelector('img[alt]');
              if (img && img.alt && !img.alt.toLowerCase().includes('linkedin')) {
                name = img.alt.replace(/'s profile picture$/i, '').trim();
              }
            }
          }

          // Try link text content
          if (!name) {
            const text = link.textContent.trim();
            if (text && text.length > 1 && text.length < 60 && !text.toLowerCase().includes('message')) {
              name = text.replace(/•.*/, '').trim();
            }
          }

          // URL fallback
          if (!name) {
            const urlMatch = profileUrl.match(/\/in\/([^\/]+)/);
            if (urlMatch) {
              name = urlMatch[1].replace(/-/g, ' ').replace(/\d+/g, '').trim()
                .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
          }

          if (name && profileUrl) {
            const fullUrl = profileUrl.startsWith('http') ? profileUrl : 'https://www.linkedin.com' + profileUrl;

            // Try to get mutual connections from card
            let mutualConnections = '';
            if (card) {
              mutualConnections = this.findMutualConnectionsInfoNew(card);
            }

            profileDetails.push({ name, url: fullUrl, mutualConnections });
          }
        } catch (error) {
          continue;
        }
      }

      if (profileDetails.length > 0) {
        console.log(`Alternative extraction succeeded: ${profileDetails.length} profiles`);
        return profileDetails;
      }

      // Strategy 2: Legacy selectors
      const legacySelectors = [
        'li.reusable-search__entity-result',
        '.entity-result__title-text a',
        '.reusable-search__result-container a[href*="/in/"]'
      ];

      for (let selector of legacySelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) continue;
        console.log(`Trying legacy selector "${selector}": found ${elements.length} elements`);

        for (let element of elements) {
          try {
            let profileUrl, name;
            if (selector === 'li.reusable-search__entity-result') {
              const linkElement = element.querySelector('a.app-aware-link');
              if (linkElement) {
                profileUrl = linkElement.getAttribute('href').split('?')[0];
                const nameElement = linkElement.querySelector('span[dir="ltr"] span[aria-hidden="true"]');
                if (nameElement) name = nameElement.textContent.trim();
              }
            } else {
              profileUrl = element.getAttribute('href')?.split('?')[0];
              name = element.textContent.trim() || element.querySelector('span')?.textContent?.trim();
            }
            if (name && profileUrl && !profileDetails.some(p => p.url === profileUrl)) {
              profileDetails.push({ name, url: profileUrl });
            }
          } catch (error) { continue; }
        }
        if (profileDetails.length > 0) break;
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
    // UPDATED: Use new data-testid selector for pagination
    const nextButton = document.querySelector('button[data-testid="pagination-controls-next-button-visible"]');
    const isDisabled = !nextButton || nextButton.hasAttribute('disabled');
    
    return {
      success: true,
      isLastPage: isDisabled
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
    
    // UPDATED: Use new data-testid selector for pagination
    const nextButton = document.querySelector('button[data-testid="pagination-controls-next-button-visible"]:not([disabled])');
    
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
    // Strategy 1 (2026): Filter pills use aria-label="Filter by <Name>" with aria-checked="true"
    // Skip generic filters like "2nd connections", "3rd+ connections", "Locations", "Current companies", etc.
    const skipLabels = ['2nd connections', '3rd+ connections', 'locations', 'current companies', 'actively hiring'];
    const filterDivs = document.querySelectorAll('div[aria-label^="Filter by"]');
    for (let div of filterDivs) {
      const parentRadio = div.closest('[aria-checked="true"], [aria-expanded]');
      if (!parentRadio) continue;
      // Only consider checked/active filters
      if (parentRadio.getAttribute('aria-checked') !== 'true' &&
          parentRadio.getAttribute('aria-expanded') !== 'true') continue;

      const ariaLabel = div.getAttribute('aria-label') || '';
      const filterValue = ariaLabel.replace(/^Filter by\s+/i, '').trim();
      if (!filterValue) continue;
      if (skipLabels.some(skip => filterValue.toLowerCase() === skip)) continue;

      // This looks like a person's name filter
      return filterValue;
    }

    // Strategy 2: Legacy filter pill button
    const filterPill = document.querySelector('button[id="searchFilter_connectionOf"]');
    if (filterPill && filterPill.textContent.trim()) {
      const name = filterPill.textContent.trim();
      if (name && !name.includes('Connections of')) {
        return name;
      }
    }

    // Strategy 3: Legacy filter label
    const filterLabel = document.querySelector('.search-reusables__value-label .t-14.t-black--light.t-normal[aria-hidden="true"]');
    if (filterLabel && filterLabel.textContent.trim()) {
      return filterLabel.textContent.trim();
    }

    // Strategy 4: URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const connectionOfParam = urlParams.get('facetConnectionOf') || urlParams.get('connectionOf');
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
             document.querySelector('div[data-view-name="connections-list"]') ||
             // New 2026 structure: connections page has figure elements with profile pictures
             document.querySelectorAll('figure[aria-label*="profile picture"]').length > 0));
  }

  isSearchResultsPage() {
    return window.location.href.includes('/search/results/people/') ||
           (window.location.href.startsWith('file://') &&
            (document.querySelector('.reusable-search__entity-result-list') ||
             document.querySelector('li.reusable-search__entity-result') ||
             // 2026 structure: search results use role="list" with role="listitem" children
             document.querySelector('div[role="list"] div[role="listitem"]')));
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