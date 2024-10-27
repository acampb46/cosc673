const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const axios = require('axios');
const {chromium} = require('playwright-extra');
const stealth = require("puppeteer-extra-plugin-stealth")();

require('dotenv').config();
// Environment Variables
const dbHost = process.env.DB_HOST;
const dbUser = process.env.DB_USER;
const dbPassword = process.env.DB_PASSWORD;
const dbName = process.env.DB_NAME;

let connection;

// MySQL connection setup
async function initializeDatabase() {
    connection = await mysql.createConnection({
        host: dbHost, user: dbUser, password: dbPassword, database: dbName
    });

    console.log('Connected to searchEngine database with robot.js');
}

initializeDatabase().catch(err => {
    console.error('Failed to connect to the database:', err);
});

// Helper function to count keywords/phrases in content, ignoring tags, comments, and case
function countOccurrences(content, searchTerms) {
    content = content.replace(/<!--.*?-->|<[^>]*>/g, "").toLowerCase(); // Remove comments, tags, and convert to lowercase
    let rank = 0;
    searchTerms.forEach(term => {
        const regex = new RegExp(`\\b${term.toLowerCase()}\\b`, "gi"); // Convert each term to lowercase
        rank += (content.match(regex) || []).length;
    });
    return rank;
}

// Function to fetch HTML with Playwright (for JavaScript-heavy pages)
const fetchHtmlWithPlaywright = async (url, retries = 3) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        chromium.use(stealth);
        const browser = await chromium.launch({headless: true});
        const page = await browser.newPage();

        // Set custom headers
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        });

        await page.goto(url, { waitUntil: 'domcontentloaded' }); // Wait for page load

        // Add another random delay of 1 to 5 seconds
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 4000 + 1000)));
        // Scroll the page to load additional content
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        // Add another random delay of 1 to 5 seconds
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 4000 + 1000)));

        const content = await page.content(); // Get HTML content of the page
        await browser.close();
        return content;
    } catch (error) {
        console.error(`Error navigating to URL with Playwright ${url}:`, error);

        // Check if it's a verification error and if there are retries left
        if (retries > 0) {
            console.log(`Waiting for 10 seconds before retrying...`);
            await sleep(10000); // 10-second wait
            return fetchHtmlWithPlaywright(url, retries - 1); // Retry fetching data
        }
    }
};

// Search route
router.get("/search", async (req, res) => {
    const {query, operator} = req.query; // Access query parameters
    const isAndOperation = operator === "AND";

    if (!query) {
        return res.status(400).json({error: 'Query parameter is required.'});
    }

    // Extract keywords and phrases
    const searchTerms = query.match(/"[^"]+"|'[^']+'|\S+/g) || [];
    const keywords = searchTerms.map(term => term.replace(/['"]+/g, ''));

    // Initial search in urlKeyword table
    const placeholders = keywords.map(() => "keyword LIKE ?").join(isAndOperation ? " AND " : " OR ");
    const values = keywords.map(term => `%${term}%`);

    try {
        const [rows] = await connection.query(`SELECT urlKeyword.url, urlDescription.description
                                               FROM urlKeyword
                                                        JOIN urlDescription ON urlDescription.url = urlKeyword.url
                                               WHERE ${placeholders}`, values);

        // Real-time rank calculation
        const results = await Promise.all(rows.map(async ({url, description}) => {
            try {
                const response = await fetchHtmlWithPlaywright(url);
                const content = response.data; // HTML content as text

                let rank = 0;
                if (isAndOperation) {
                    if (keywords.every(term => content.includes(term))) {
                        rank = countOccurrences(content, keywords);
                    }
                } else {
                    rank = countOccurrences(content, keywords);
                }

                return {url, description, rank};
            } catch (err) {
                console.error(`Error fetching ${url}:`, err);
                return null;
            }
        }));

        // Sort by rank in descending order and filter out null results
        const sortedResults = results.filter(Boolean).sort((a, b) => b.rank - a.rank);

        // Respond with formatted results
        res.json({
            query, urls: sortedResults // Ensure this is the structure you expect in your client-side code
        });
    } catch (error) {
        console.error('Error executing query:', error);
        res.status(500).json({error: 'Database query failed.'});
    }
});

module.exports = router;
