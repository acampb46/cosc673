const express = require('express');
const router = express.Router(); // For using routes with node.js
const mysql = require('mysql2'); // MySQL for connection to the database
const puppeteer = require('puppeteer'); // Use Puppeteer for web crawling
const { parse } = require('node-html-parser'); // node-html-parser for HTML parsing

// Constants
const k = 10; // Number of keywords to extract
const n = 500; // Minimum number of entries in urlDescription

// MySQL connection setup
const connection = mysql.createConnection({
    host: '3.19.85.118',
    user: 'COSC631',
    password: 'COSC631',
    database: 'searchEngine'
});

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to searchEngine database with start.js');
});

// Function to extract keywords and description from the HTML content
const extractKeywordsAndDescription = (root) => {
    let keywords = new Set();
    let description = '';

    // Helper function to add keywords from a string
    const addKeywordsFromString = (str) => {
        str.split(/\s+/)
            .filter(word => word.length >= 3) // Filter out words less than 3 characters
            .forEach(word => keywords.add(word));
    };

    // (a) Extract meta keywords
    const metaKeywords = root.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
        const keywordContent = metaKeywords.getAttribute('content');
        if (keywordContent) {
            addKeywordsFromString(keywordContent);  // Only add keywords from <meta> tag
        }
    }

    // (b) Extract meta description
    const metaDescription = root.querySelector('meta[name="description"]');
    if (metaDescription) {
        description = metaDescription.getAttribute('content')?.slice(0, 200) || '';
    }

    // Return the first k keywords and the description
    return { keywords: Array.from(keywords).slice(0, k), description };
};

// Function to start the crawling process
const crawlUrls = async () => {
    return new Promise((resolve, reject) => {
        // 1. Get all available URLs from the robotUrl table ordered by pos
        connection.query('SELECT * FROM robotUrl ORDER BY pos', async (err, results) => {
            if (err) {
                console.error('Error fetching URLs:', err);
                return reject('Database query error');
            }

            // Loop through each URL in results
            for (const row of results) {
                let nextUrl = row.url;

                // Add protocol if missing
                if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
                    nextUrl = 'https://' + nextUrl;  // Default to https if protocol is missing
                }

                let browser;
                try {
                    // 2. Launch Puppeteer and fetch the page content
                    const urlObj = new URL(nextUrl);
                    const host = urlObj.host; // Gives just the host name

                    console.log(`Crawling URL: ${nextUrl}`);
                    console.log(`Extracted host: ${host}`);

                    browser = await puppeteer.launch({
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });

                    const page = await browser.newPage();
                    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

                    // Try navigating to the next URL in the table
                    console.log("Navigating to URL...");
                    await page.goto(nextUrl, { waitUntil: 'networkidle0', timeout: 0 });
                    const html = await page.content();
                    console.log('Page fetched successfully.');

                    // Parse the HTML document using node-html-parser
                    const root = parse(html);

                    // Extract keywords and description from <meta> tags
                    const { keywords, description } = extractKeywordsAndDescription(root);

                    // Insert URL and description into urlDescription table
                    connection.query(
                        'INSERT INTO urlDescription (url, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = ?',
                        [nextUrl, description, description],
                        (err) => {
                            if (err) throw err;
                            console.log(`Inserted description for URL: ${nextUrl}`);
                        }
                    );

                    // Insert each keyword and its rank into urlKeyword table
                    for (const keyword of keywords) {
                        const rank = (html.match(new RegExp(keyword, 'gi')) || []).length;
                        connection.query(
                            'INSERT INTO urlKeyword (url, keyword, `rank`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `rank` = ?',
                            [nextUrl, keyword, rank, rank],
                            (err) => {
                                if (err) throw err;
                                console.log(`Inserted keyword: ${keyword}, Rank: ${rank}`);
                            }
                        );
                    }

                    // Extract all links and insert them into robotUrl table (if needed)
                    const links = root.querySelectorAll('a').map(link => link.getAttribute('href')).filter(href => href);
                    for (const link of links) {
                        const absoluteUrl = new URL(link, nextUrl).href; // Make sure to convert relative links to absolute

                        // Use the host extracted earlier
                        const host = new URL(absoluteUrl).host; // Extract the host from the absolute URL

                        // Insert the host into robotUrl table
                        connection.query('SELECT COUNT(*) AS count FROM robotUrl WHERE url = ?', [host], (err, results) => {
                            if (err) throw err;
                            if (results[0].count === 0) { // Only insert if the count is 0
                                connection.query(
                                    'INSERT INTO robotUrl (url) VALUES (?)',
                                    [host],
                                    (err) => {
                                        if (err) throw err;
                                        console.log(`Inserted new URL to crawl: ${host}`);
                                    }
                                );
                            }
                        });
                    }

                    // Check the number of entries in urlDescription table
                    connection.query('SELECT COUNT(*) AS count FROM urlDescription', (err, countResults) => {
                        if (err) {
                            console.error('Error counting entries in urlDescription:', err);
                            reject('Error counting entries');
                        } else if (countResults[0].count < n) {
                            console.log('Continuing to crawl due to insufficient entries in urlDescription');
                        }
                    });
                } catch (error) {
                    console.error('Error fetching URL:', error);
                } finally {
                    // Close the Puppeteer browser as soon as possible to free up CPU
                    if (browser) {
                        console.log("Closing Puppeteer browser...");
                        await browser.close();
                    }
                }
            }
            resolve(); // Resolve when done with all URLs
        });
    });
};


// Start the crawling process when the endpoint is hit
router.get('/start', async (req, res) => {
    try {
        await crawlUrls(); // Start crawling
        res.json({ message: 'Crawling process started.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error starting crawling process' });
    }
});

module.exports = router;
