const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise'); // MySQL for connection to the database
const puppeteer = require('puppeteer'); // Use Puppeteer for web crawling
const { parse } = require('node-html-parser'); // node-html-parser for HTML parsing

// Constants
const k = 10; // Number of keywords to extract
const n = 500; // Minimum number of entries in urlDescription

// MySQL connection pool
const connection = mysql.createPool({
    host: '3.19.85.118',
    user: 'COSC631',
    password: 'COSC631',
    database: 'searchEngine',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test connection by acquiring a connection from the pool
async function testConnection() {
    try {
        const conn = await connection.getConnection();
        console.log('Connected to searchEngine database with start.js');
        conn.release();
    } catch (err) {
        console.error('Error connecting to the database:', err);
    }
}

// Call the test connection function
testConnection();

// Function to extract keywords and description from the HTML content
const extractKeywordsAndDescription = (root) => {
    let keywords = new Set();
    let description = '';

    const addKeywordsFromString = (str) => {
        str.split(/\s+/)
            .filter(word => word.length >= 3)
            .forEach(word => keywords.add(word));
    };

    const metaKeywords = root.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
        addKeywordsFromString(metaKeywords.getAttribute('content'));
    }

    const titleTag = root.querySelector('title');
    if (titleTag) {
        addKeywordsFromString(titleTag.text);
        description = titleTag.text.slice(0, 200);
    }

    const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (let heading of headings) {
        addKeywordsFromString(heading.text);
        if (!description) {
            description = heading.text.slice(0, 200);
        }
    }

    const bodyText = root.querySelector('body')?.text || '';
    addKeywordsFromString(bodyText);
    if (!description) {
        description = bodyText.slice(0, 200);
    }

    return { keywords: Array.from(keywords).slice(0, k), description };
};

// Function to start the crawling process
const crawlUrls = async () => {
    let browser;

    try {
        // Launch the browser instance
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const [results] = await connection.query('SELECT * FROM robotUrl ORDER BY pos');
        console.log(`Fetched ${results.length} URLs from robotUrl`);

        for (let row of results) {
            let nextUrl = row.url;
            if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
                nextUrl = 'https://' + nextUrl;
            }

            console.log(`Preparing to crawl URL: ${nextUrl}`);

            try {
                const page = await browser.newPage();
                const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
                await page.setUserAgent(userAgent);

                console.log(`Crawling URL: ${nextUrl}`);
                await page.goto(nextUrl, { waitUntil: 'domcontentloaded' });
                const html = await page.content();
                const root = parse(html);

                const { keywords, description } = extractKeywordsAndDescription(root);

                // Insert description
                await connection.query(
                    'INSERT INTO urlDescription (url, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = ?',
                    [nextUrl, description, description]
                );
                console.log(`Inserted description for URL: ${nextUrl}`);

                // Insert keywords
                for (const keyword of keywords) {
                    const rank = (html.match(new RegExp(keyword, 'gi')) || []).length;
                    await connection.query(
                        'INSERT INTO urlKeyword (url, keyword, `rank`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `rank` = ?',
                        [nextUrl, keyword, rank, rank]
                    );
                    console.log(`Inserted keyword: ${keyword}, Rank: ${rank}`);
                }

                // Extract and insert new links into robotUrl
                const links = root.querySelectorAll('a').map(link => link.getAttribute('href')).filter(href => href);
                for (const link of links) {
                    const absoluteUrl = new URL(link, nextUrl).href;
                    const host = new URL(absoluteUrl).host;

                    const [countResults] = await connection.query('SELECT COUNT(*) AS count FROM robotUrl WHERE url = ?', [host]);
                    if (countResults[0].count === 0) {
                        await connection.query('INSERT INTO robotUrl (url) VALUES (?)', [host]);
                        console.log(`Inserted new URL to crawl: ${host}`);
                    }
                }

                // Check if the number of entries in urlDescription is below the minimum threshold
                const [count] = await connection.query('SELECT COUNT(*) AS count FROM urlDescription');
                if (count[0].count < n) {
                    console.log('Continuing to crawl due to insufficient entries in urlDescription');
                } else {
                    console.log('Crawling process completed.');
                    break;
                }

            } catch (error) {
                console.error(`Error crawling URL: ${nextUrl}`, error);
            } finally {
                await page.close();
            }
        }

    } catch (error) {
        console.error('Error fetching URLs:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};

// Start the crawling process when the endpoint is hit
router.get('/start', async (req, res) => {
    try {
        await crawlUrls();
        res.json({ message: 'Crawling process started.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error starting crawling process' });
    }
});

module.exports = router;
