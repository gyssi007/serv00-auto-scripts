import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { fileURLToPath } from 'url';

// 用于收集所有消息
let messages = [];

function formatToISO(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}Z/, '');
}

async function delayTime(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(token, chatId, message) {
    if (process.env.COLLECT_MESSAGES === 'true') {
        // 收集消息而不是立即发送
        messages.push(message);
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const data = {
        chat_id: chatId,
        text: message
    };
    try {
        const response = await axios.post(url, data);
        console.log('消息已发送到 Telegram');
    } catch (error) {
        console.error('Telegram 消息发送失败');
    }
}

// 发送汇总消息的函数
async function sendSummaryMessage(token, chatId) {
    if (messages.length === 0) return;
    
    const summary = `登录任务汇总报告:\n\n${messages.join('\n\n-------------------\n\n')}`;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const data = {
        chat_id: chatId,
        text: summary
    };
    
    try {
        const response = await axios.post(url, data);
        console.log('汇总消息已发送到 Telegram');
    } catch (error) {
        console.error('汇总消息发送失败');
    }
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../accounts.json'), 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    for (const account of accounts) {
        const { username, password, panel } = account;

        const browser = await puppeteer.launch({ 
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });
        const page = await browser.newPage();

        let url = `https://${panel}/login/?next=/`;

        try {
            await page.goto(url);

            const usernameInput = await page.$('#id_username');
            if (usernameInput) {
                await usernameInput.click({ clickCount: 3 });
                await usernameInput.press('Backspace');
            }
            await page.type('#id_username', username);
            await page.type('#id_password', password);

            const loginButton = await page.$('#submit');
            if (loginButton) {
                await loginButton.click();
            } else {
                throw new Error('无法找到登录按钮');
            }

            await page.waitForNavigation();

            const isLoggedIn = await page.evaluate(() => {
                const logoutButton = document.querySelector('a[href="/logout/"]');
                return logoutButton !== null;
            });

            if (isLoggedIn) {
                const nowUtc = formatToISO(new Date());
                const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));
                const message = `账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）登录成功！`;
                console.log(message);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, message);
                }
            } else {
                const message = `账号 ${username} 登录失败，请检查账号和密码是否正确。`;
                console.error(message);
                if (telegramToken && telegramChatId) {
                    await sendTelegramMessage(telegramToken, telegramChatId, message);
                }
            }
        } catch (error) {
            const message = `账号 ${username} 登录时出现错误: ${error.message}`;
            console.error(message);
            if (telegramToken && telegramChatId) {
                await sendTelegramMessage(telegramToken, telegramChatId, message);
            }
        } finally {
            await page.close();
            await browser.close();
            const delay = Math.floor(Math.random() * 5000) + 1000;
            await delayTime(delay);
        }
    }

    // 所有账号处理完成后，发送汇总消息
    if (process.env.COLLECT_MESSAGES === 'true' && telegramToken && telegramChatId) {
        await sendSummaryMessage(telegramToken, telegramChatId);
    }

    console.log('所有账号登录完成！');
})();
