#!/usr/bin/env node

/**
 * Setup Verification Script
 *
 * Run this script to verify your environment is properly configured
 * before starting the Teams-Freshchat bridge PoC.
 *
 * Usage: node verify-setup.js
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ANSI color codes for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const { red, green, yellow, blue, cyan, reset } = colors;

// Verification results
const results = {
    passed: [],
    failed: [],
    warnings: []
};

function log(message, color = reset) {
    console.log(`${color}${message}${reset}`);
}

function checkPassed(name) {
    results.passed.push(name);
    log(`✓ ${name}`, green);
}

function checkFailed(name, reason) {
    results.failed.push({ name, reason });
    log(`✗ ${name}`, red);
    log(`  → ${reason}`, red);
}

function checkWarning(name, reason) {
    results.warnings.push({ name, reason });
    log(`⚠ ${name}`, yellow);
    log(`  → ${reason}`, yellow);
}

async function verifySetup() {
    log('\n╔══════════════════════════════════════════════════════════╗', cyan);
    log('║  Teams ↔ Freshchat Bridge - Setup Verification          ║', cyan);
    log('╚══════════════════════════════════════════════════════════╝\n', cyan);

    // 1. Check Node.js version
    log('\n[1/10] Checking Node.js version...', blue);
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    if (majorVersion >= 18) {
        checkPassed(`Node.js ${nodeVersion} (>= 18.0.0 required)`);
    } else {
        checkFailed('Node.js version', `Found ${nodeVersion}, but >= 18.0.0 required`);
    }

    // 2. Check required dependencies
    log('\n[2/10] Checking dependencies...', blue);
    const requiredDeps = ['express', 'botbuilder', 'axios', 'dotenv'];
    const packageJsonPath = path.join(__dirname, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const installedDeps = packageJson.dependencies || {};

        let allDepsPresent = true;
        for (const dep of requiredDeps) {
            if (installedDeps[dep]) {
                checkPassed(`Dependency: ${dep} (${installedDeps[dep]})`);
            } else {
                checkFailed(`Dependency: ${dep}`, 'Not found in package.json');
                allDepsPresent = false;
            }
        }

        // Check if node_modules exists
        if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
            checkWarning('node_modules', 'Directory not found. Run: npm install');
        }
    } else {
        checkFailed('package.json', 'File not found');
    }

    // 3. Check .env file
    log('\n[3/10] Checking environment configuration...', blue);
    if (fs.existsSync(path.join(__dirname, '.env'))) {
        checkPassed('.env file exists');
    } else {
        checkFailed('.env file', 'Not found. Copy .env.example to .env');
    }

    // 4. Check environment variables
    log('\n[4/10] Checking environment variables...', blue);
    const requiredEnvVars = [
        'BOT_APP_ID',
        'BOT_APP_PASSWORD',
        'FRESHCHAT_API_KEY',
        'FRESHCHAT_API_URL',
        'FRESHCHAT_INBOX_ID'
    ];

    for (const envVar of requiredEnvVars) {
        const value = process.env[envVar];
        if (value && !value.includes('your-') && !value.includes('-here')) {
            checkPassed(`${envVar} is set`);
        } else if (!value) {
            checkFailed(`${envVar}`, 'Not set in .env file');
        } else {
            checkWarning(`${envVar}`, 'Still has placeholder value');
        }
    }

    // 5. Check Freshchat API connectivity
    log('\n[5/10] Testing Freshchat API connection...', blue);
    const freshchatApiKey = process.env.FRESHCHAT_API_KEY;
    const freshchatApiUrl = process.env.FRESHCHAT_API_URL;

    if (freshchatApiKey && freshchatApiUrl && !freshchatApiKey.includes('your-')) {
        try {
            const response = await axios.get(`${freshchatApiUrl}/users`, {
                headers: {
                    'Authorization': `Bearer ${freshchatApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            if (response.status === 200) {
                checkPassed('Freshchat API connection successful');
            }
        } catch (error) {
            if (error.response) {
                checkFailed('Freshchat API', `HTTP ${error.response.status}: ${error.response.statusText}`);
            } else if (error.code === 'ECONNABORTED') {
                checkFailed('Freshchat API', 'Connection timeout');
            } else {
                checkFailed('Freshchat API', error.message);
            }
        }
    } else {
        checkWarning('Freshchat API', 'Cannot test - API key not configured');
    }

    // 6. Check Teams manifest
    log('\n[6/10] Checking Teams app manifest...', blue);
    const manifestPath = path.join(__dirname, 'teams-app', 'manifest.json');

    if (fs.existsSync(manifestPath)) {
        checkPassed('manifest.json exists');

        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            // Check if bot ID is configured
            if (manifest.id && !manifest.id.includes('REPLACE')) {
                checkPassed('Manifest ID is configured');
            } else {
                checkWarning('Manifest ID', 'Still has placeholder value');
            }

            // Check if bots array has bot ID
            if (manifest.bots && manifest.bots[0] && manifest.bots[0].botId) {
                if (!manifest.bots[0].botId.includes('REPLACE')) {
                    checkPassed('Bot ID is configured in manifest');
                } else {
                    checkWarning('Bot ID', 'Still has placeholder value');
                }
            }
        } catch (error) {
            checkFailed('manifest.json', `Parse error: ${error.message}`);
        }
    } else {
        checkFailed('manifest.json', 'Not found in teams-app directory');
    }

    // 7. Check Teams app icons
    log('\n[7/10] Checking Teams app icons...', blue);
    const colorIconPath = path.join(__dirname, 'teams-app', 'color.png');
    const outlineIconPath = path.join(__dirname, 'teams-app', 'outline.png');

    if (fs.existsSync(colorIconPath)) {
        const stats = fs.statSync(colorIconPath);
        if (stats.size > 0) {
            checkPassed('color.png exists');
        } else {
            checkWarning('color.png', 'File is empty');
        }
    } else {
        checkWarning('color.png', 'Not found. Create 192x192 icon');
    }

    if (fs.existsSync(outlineIconPath)) {
        const stats = fs.statSync(outlineIconPath);
        if (stats.size > 0) {
            checkPassed('outline.png exists');
        } else {
            checkWarning('outline.png', 'File is empty');
        }
    } else {
        checkWarning('outline.png', 'Not found. Create 32x32 icon');
    }

    // 8. Check Teams app package
    log('\n[8/10] Checking Teams app package...', blue);
    const appPackagePath = path.join(__dirname, 'teams-app', 'teams-freshchat-bot.zip');

    if (fs.existsSync(appPackagePath)) {
        checkPassed('teams-freshchat-bot.zip exists');
    } else {
        checkWarning('App package', 'teams-freshchat-bot.zip not found. Run: cd teams-app && zip -r teams-freshchat-bot.zip manifest.json color.png outline.png');
    }

    // 9. Check if ngrok is installed
    log('\n[9/10] Checking ngrok installation...', blue);
    try {
        const { execSync } = require('child_process');
        const ngrokVersion = execSync('ngrok version', { encoding: 'utf8' }).trim();
        checkPassed(`ngrok is installed (${ngrokVersion})`);
    } catch (error) {
        checkWarning('ngrok', 'Not found in PATH. Install from: https://ngrok.com/download');
    }

    // 10. Check if port 3978 is available
    log('\n[10/10] Checking port availability...', blue);
    const net = require('net');
    const port = process.env.PORT || 3978;

    const server = net.createServer();

    return new Promise((resolve) => {
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                checkWarning(`Port ${port}`, 'Already in use. Stop existing server or use different port');
            } else {
                checkWarning(`Port ${port}`, `Error: ${err.message}`);
            }
            resolve();
        });

        server.once('listening', () => {
            checkPassed(`Port ${port} is available`);
            server.close();
            resolve();
        });

        server.listen(port);
    });
}

async function printSummary() {
    log('\n╔══════════════════════════════════════════════════════════╗', cyan);
    log('║  Verification Summary                                     ║', cyan);
    log('╚══════════════════════════════════════════════════════════╝\n', cyan);

    log(`✓ Passed:   ${results.passed.length}`, green);
    log(`⚠ Warnings: ${results.warnings.length}`, yellow);
    log(`✗ Failed:   ${results.failed.length}`, red);

    if (results.failed.length === 0 && results.warnings.length === 0) {
        log('\n🎉 All checks passed! You\'re ready to start the bridge.', green);
        log('\nNext steps:', cyan);
        log('  1. Start ngrok: ngrok http 3978');
        log('  2. Update Azure Bot and Freshchat with ngrok URL');
        log('  3. Start server: npm start');
        log('  4. Sideload Teams app\n');
    } else if (results.failed.length === 0) {
        log('\n⚠️  Setup is mostly ready, but please address warnings.', yellow);
        log('\nWarnings:', yellow);
        results.warnings.forEach(w => {
            log(`  • ${w.name}: ${w.reason}`, yellow);
        });
    } else {
        log('\n❌ Setup is incomplete. Please fix the failed checks.', red);
        log('\nFailed checks:', red);
        results.failed.forEach(f => {
            log(`  • ${f.name}: ${f.reason}`, red);
        });

        if (results.warnings.length > 0) {
            log('\nWarnings:', yellow);
            results.warnings.forEach(w => {
                log(`  • ${w.name}: ${w.reason}`, yellow);
            });
        }
    }

    log('\nFor detailed setup instructions, see: README.md\n');
}

// Run verification
(async () => {
    try {
        await verifySetup();
        await printSummary();
        process.exit(results.failed.length > 0 ? 1 : 0);
    } catch (error) {
        log(`\n❌ Verification failed with error: ${error.message}\n`, red);
        console.error(error);
        process.exit(1);
    }
})();
