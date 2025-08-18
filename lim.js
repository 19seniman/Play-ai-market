require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    white: "\x1b[37m",
    bold: "\x1b[1m",
};

const logger = {
    info: (msg) => console.log(`${colors.cyan}[i] ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}[⚠] ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
    loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
    step: (msg) => console.log(`\n${colors.white}${colors.bold}[➤] ${msg}${colors.reset}`),
    banner: () => {
        console.log(`${colors.cyan}${colors.bold}`);
        console.log('-----------------------------------------------');
        console.log('         PlayAI Auto-Vote Bot Script           ');
        console.log('-----------------------------------------------');
        console.log(`${colors.reset}`);
    },
};

const getUserAgent = () => {
    const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
};

function readProxies() {
    try {
        const proxies = fs.readFileSync('proxies.txt', 'utf8').split('\n').filter(p => p.trim() !== '');
        if (proxies.length === 0) {
            logger.warn('proxies.txt is empty. Continuing without proxies.');
            return [];
        }
        logger.info(`Loaded ${proxies.length} proxies.`);
        return proxies;
    } catch (error) {
        logger.warn('proxies.txt not found. Continuing without proxies.');
        return [];
    }
}

class PlayAIBot {
    constructor(privateKey, index, proxy = null) {
        this.privateKey = privateKey;
        this.index = index;
        this.proxy = proxy;
        this.wallet = new ethers.Wallet(privateKey);
        this.address = this.wallet.address;
        this.jwt = null;
        this.userAgent = getUserAgent();
        this.baseURL = 'https://hub-playai.up.railway.app';
        this.chatURL = 'https://play-hub.up.railway.app';

        const axiosConfig = {
            timeout: 60000,
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-US,en;q=0.9',
                'user-agent': this.userAgent,
                'origin': 'https://hub.playai.network',
                'referer': 'https://hub.playai.network/'
            }
        };

        if (this.proxy) {
            try {
                const proxyHost = this.proxy.includes('@') ? this.proxy.split('@')[1] : this.proxy;
                logger.info(`[Wallet ${this.index}] Using proxy: ${proxyHost}`);
                const proxyAgent = new HttpsProxyAgent(this.proxy);
                axiosConfig.httpsAgent = proxyAgent;
                axiosConfig.proxy = false;
            } catch (error) {
                logger.error(`[Wallet ${this.index}] Invalid proxy format: ${this.proxy}. Error: ${error.message}`);
                logger.warn(`[Wallet ${this.index}] Continuing without proxy.`);
            }
        }

        this.axios = axios.create(axiosConfig);
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async signMessage(message) {
        try {
            return await this.wallet.signMessage(message);
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Failed to sign message: ${error.message}`);
            throw error;
        }
    }

    async login() {
        try {
            logger.info(`[Wallet ${this.index}] Authenticating wallet...`);
            const nonceResponse = await this.axios.get(`${this.baseURL}/auth/wallet`);
            const { message, nonce } = nonceResponse.data;

            const signature = await this.signMessage(message);

            const loginResponse = await this.axios.post(`${this.baseURL}/auth/wallet`, {
                nonce,
                signature,
                wallet: this.address
            }, {
                headers: { 'content-type': 'application/json' }
            });

            this.jwt = loginResponse.data.jwt;
            this.axios.defaults.headers['authorization'] = `Bearer ${this.jwt}`;
            logger.success(`[Wallet ${this.index}] Login successful!`);
            return true;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Login failed: ${error.response?.data?.message || error.message}`);
            return false;
        }
    }

    async getUserInfo() {
        try {
            const response = await this.axios.get(`${this.baseURL}/user`);
            const { username, referralCount, wallets } = response.data;
            logger.info(`[Wallet ${this.index}] User: ${username || 'N/A'}, Referrals: ${referralCount}, Wallets: ${wallets.length}`);
            return response.data;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Failed to get user info: ${error.message}`);
            return null;
        }
    }

    async checkIn() {
        try {
            logger.info(`[Wallet ${this.index}] Performing daily check-in...`);
            const response = await this.axios.post(`${this.baseURL}/user/streak`);
            logger.success(`[Wallet ${this.index}] Check-in successful! Streak: ${response.data.streak} days`);
            return response.data;
        } catch (error) {
            if (error.response?.status === 400) {
                logger.warn(`[Wallet ${this.index}] Already checked in today.`);
            } else {
                logger.error(`[Wallet ${this.index}] Check-in failed: ${error.response?.data?.message || error.message}`);
            }
            return null;
        }
    }

    async getMissions() {
        try {
            const response = await this.axios.get(`${this.baseURL}/user/missions`);
            return response.data;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Failed to get missions: ${error.message}`);
            return [];
        }
    }

    async completeMission(missionId) {
        try {
            logger.info(`[Wallet ${this.index}] Completing mission: ${missionId}`);
            const response = await this.axios.post(`${this.baseURL}/user/missions/${missionId}/verify`);
            logger.success(`[Wallet ${this.index}] Mission ${missionId} completed! Credit: ${response.data.credit}`);
            return response.data;
        } catch (error) {
            if (error.response?.status === 400) {
                logger.warn(`[Wallet ${this.index}] Mission ${missionId} already completed or not available.`);
            } else {
                logger.error(`[Wallet ${this.index}] Failed to complete mission ${missionId}: ${error.response?.data?.message || error.message}`);
            }
            return null;
        }
    }

    async completeAllMissions() {
        logger.step(`[Wallet ${this.index}] Starting mission completion...`);
        const missions = await this.getMissions();
        const incompleteMissions = missions.filter(mission => !mission.completed);

        if (incompleteMissions.length === 0) {
            logger.info(`[Wallet ${this.index}] No new missions to complete.`);
            return;
        }

        logger.info(`[Wallet ${this.index}] Found ${incompleteMissions.length} incomplete missions.`);
        for (const mission of incompleteMissions) {
            await this.completeMission(mission.id);
            await this.delay(2000);
        }
        logger.success(`[Wallet ${this.index}] All available missions processed!`);
    }

    async getVoteQuota() {
        try {
            const response = await this.axios.get(`${this.baseURL}/mining/quota/vote`);
            return response.data;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Failed to get vote quota: ${error.message}`);
            return null;
        }
    }

    async getTweetIds() {
        try {
            logger.info(`[Wallet ${this.index}] Fetching available tweets for voting...`);
            const allTweetIds = [];
            let page = 1;
            const limit = 50;
            let hasMore = true;

            while (hasMore && page <= 5) {
                try {
                    const response = await this.axios.get(`${this.baseURL}/mining/tweets?page=${page}&limit=${limit}`);
                    const tweets = response.data.result;

                    if (tweets && tweets.length > 0) {
                        const tweetIds = tweets.map(tweet => tweet.id).filter(Boolean);
                        allTweetIds.push(...tweetIds);
                        if (tweets.length < limit) hasMore = false;
                    } else {
                        hasMore = false;
                    }
                    page++;
                    await this.delay(1000);
                } catch (pageError) {
                    logger.warn(`[Wallet ${this.index}] Failed to fetch page ${page}: ${pageError.message}`);
                    hasMore = false;
                }
            }

            const uniqueTweetIds = [...new Set(allTweetIds)];
            if (uniqueTweetIds.length > 0) {
                logger.success(`[Wallet ${this.index}] Fetched ${uniqueTweetIds.length} unique tweet IDs.`);
            } else {
                logger.warn(`[Wallet ${this.index}] No tweet IDs could be fetched from the API.`);
            }
            return uniqueTweetIds;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] An error occurred while fetching tweet IDs: ${error.message}`);
            return [];
        }
    }

    async performVote(tweetId, vote = true) {
        try {
            const response = await this.axios.post(`${this.baseURL}/mining/vote`, { tweetId, vote }, {
                headers: { 'content-type': 'application/json' }
            });
            return response.data;
        } catch (error) {
            if (error.response?.data?.message.includes('already voted')) {
                logger.warn(`[Wallet ${this.index}] Already voted on tweet ${tweetId}.`);
            } else {
                logger.error(`[Wallet ${this.index}] Failed to vote on ${tweetId}: ${error.response?.data?.message || error.message}`);
            }
            return null;
        }
    }

    async performAllVotes() {
        logger.step(`[Wallet ${this.index}] Starting voting process...`);
        const voteQuota = await this.getVoteQuota();
        if (!voteQuota) return;

        logger.info(`[Wallet ${this.index}] Vote Quota - Remaining: ${voteQuota.remaining}/${voteQuota.total}`);

        if (voteQuota.remaining <= 0) {
            logger.warn(`[Wallet ${this.index}] No remaining votes available.`);
            return;
        }

        const tweetIds = await this.getTweetIds();
        if (tweetIds.length === 0) {
            logger.error(`[Wallet ${this.index}] No tweet IDs found to vote on.`);
            return;
        }

        let successfulVotes = 0;
        const shuffledTweetIds = [...tweetIds].sort(() => Math.random() - 0.5);

        for (const tweetId of shuffledTweetIds) {
            if (successfulVotes >= voteQuota.remaining) {
                logger.success(`[Wallet ${this.index}] Vote quota met!`);
                break;
            }

            logger.info(`[Wallet ${this.index}] Voting on tweet ${tweetId}... [${successfulVotes}/${voteQuota.remaining}]`);
            const voteResult = await this.performVote(tweetId);

            if (voteResult) {
                successfulVotes++;
                logger.success(`[Wallet ${this.index}] Vote successful! Progress: ${successfulVotes}/${voteQuota.remaining}`);
            }

            await this.delay(2000 + Math.random() * 1000);
        }

        logger.success(`[Wallet ${this.index}] Voting process finished. Total successful votes: ${successfulVotes}`);
    }

    async getChatCount() {
        try {
            const response = await this.axios.get(`${this.chatURL}/chat/count`);
            return response.data;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Failed to get chat count: ${error.message}`);
            return null;
        }
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    async performChat(message) {
        try {
            logger.loading(`[Wallet ${this.index}] Sending chat message: "${message}"`);
            const chatId = this.generateUUID();
            await this.axios.post(`${this.chatURL}/chat/${chatId}`, { message }, {
                headers: {
                    'accept': 'text/event-stream',
                    'content-type': 'application/json'
                }
            });
            logger.success(`[Wallet ${this.index}] Chat message sent successfully!`);
            return true;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Failed to send chat: ${error.response?.data?.message || error.message}`);
            return false;
        }
    }

    async performAllChats() {
        logger.step(`[Wallet ${this.index}] Starting chat interactions...`);
        const chatCount = await this.getChatCount();
        if (!chatCount) return;

        logger.info(`[Wallet ${this.index}] Chat quota - Used: ${chatCount.count}/${chatCount.total}`);
        let remainingChats = chatCount.total - chatCount.count;
        
        if (remainingChats <= 0) {
            logger.warn(`[Wallet ${this.index}] No remaining chats available.`);
            return;
        }

        const chatMessages = [
            "show my portfolio balance",
            "what is my current balance?",
            "help me understand my wallet status"
        ];

        const chatsToPerform = Math.min(remainingChats, 3);
        for (let i = 0; i < chatsToPerform; i++) {
            await this.performChat(chatMessages[i % chatMessages.length]);
            await this.delay(5000);
        }

        logger.success(`[Wallet ${this.index}] Completed chat interactions.`);
    }

    async getMiningQuota() {
        try {
            const response = await this.axios.get(`${this.baseURL}/mining/quota`);
            return response.data;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] Failed to get mining quota: ${error.message}`);
            return null;
        }
    }

    formatTime(ms) {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    async runOnce() {
        try {
            logger.step(`[Wallet ${this.index}] Starting bot run for address: ${this.address}`);
            if (!await this.login()) return false;
            await this.delay(2000);

            await this.getUserInfo();
            await this.delay(2000);

            await this.checkIn();
            await this.delay(3000);

            await this.completeAllMissions();
            await this.delay(3000);

            await this.performAllVotes();
            await this.delay(3000);

            await this.performAllChats();

            logger.success(`[Wallet ${this.index}] All tasks for this cycle completed successfully!`);
            return true;
        } catch (error) {
            logger.error(`[Wallet ${this.index}] A critical error occurred in the main bot run: ${error.message}`);
            return false;
        }
    }

    async runWithLoop() {
        while (true) {
            const success = await this.runOnce();
            if (!success) {
                logger.warn(`[Wallet ${this.index}] Bot run failed, retrying after a short delay...`);
                await this.delay(60000); 
                continue;
            }

            logger.step(`[Wallet ${this.index}] Checking daily reset time...`);
            const quota = await this.getMiningQuota();
            let timeUntilReset = 24 * 60 * 60 * 1000; 

            if (quota && quota.resetAt) {
                const resetTime = new Date(quota.resetAt);
                const now = new Date();
                const waitTime = resetTime.getTime() - now.getTime();
                if (waitTime > 0) {
                    timeUntilReset = waitTime;
                }
            }
            
            logger.info(`[Wallet ${this.index}] Next run in: ${this.formatTime(timeUntilReset)}`);
            await this.delay(timeUntilReset + 5000); 
        }
    }
}

async function main() {
    logger.banner();

    const privateKeys = [];
    let index = 1;
    while (process.env[`PRIVATE_KEY_${index}`]) {
        privateKeys.push(process.env[`PRIVATE_KEY_${index}`]);
        index++;
    }

    if (privateKeys.length === 0) {
        logger.error('No private keys found in .env file!');
        logger.info('Please add PRIVATE_KEY_1, PRIVATE_KEY_2, etc., to your .env file.');
        return;
    }

    logger.info(`Found ${privateKeys.length} wallet(s) to process.`);
    const proxies = readProxies();

    const bots = privateKeys.map((pk, i) => {
        const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
        return new PlayAIBot(pk, i + 1, proxy);
    });

    const botPromises = bots.map((bot, i) => {
        return new Promise(async (resolve) => {
            await new Promise(res => setTimeout(res, i * 15000)); 
            logger.info(`Starting script for Wallet ${bot.index}`);
            await bot.runWithLoop();
            resolve();
        });
    });

    await Promise.all(botPromises);
}

process.on('SIGINT', () => {
    logger.warn('\nBot stopped by user.');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection: ${reason}`);
});

main().catch(error => {
    logger.error(`A fatal error occurred: ${error.message}`);
    process.exit(1);
});
