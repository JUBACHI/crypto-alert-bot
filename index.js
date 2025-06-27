require("dotenv").config();
const axios = require("axios");
const PushBullet = require("pushbullet");
const WebSocket = require("ws");

const pusher = new PushBullet.default(process.env.PUSHBULLET_TOKEN);

const ALERT_VARIATION = 7; // % variation 1h
const FUNDING_ALERT = -0.0005; // -0.05%
const INTERVAL_MINUTES = 5;
const MIN_LIQUIDATION_USD = 500000;

let coinList = [];

// 🔔 Envoi PushBullet
function sendPush(title, message) {
  pusher.note({}, title, message, (err) => {
    if (err) console.error("❌ Erreur PushBullet :", err.message);
    else console.log("📲 Notification envoyée :", title);
  });
}

// 📡 Coins Spot & Perp de Bybit
async function getBybitCoins() {
  try {
    const urls = [
      "https://api.bybit.com/v5/market/instruments-info?category=spot",
      "https://api.bybit.com/v5/market/instruments-info?category=linear",
    ];

    let all = [];

    for (const url of urls) {
      const res = await axios.get(url);
      const list = res.data.result.list;
      const coins = list
        .filter((s) => s.symbol.endsWith("USDT"))
        .map((s) => s.baseCoin.toLowerCase());
      all.push(...coins);
    }

    return [...new Set(all)];
  } catch (err) {
    console.error("❌ Erreur récupération coins Bybit :", err.message);
    return [];
  }
}

// 📊 Variation 1h CoinGecko
async function checkVariation(coin) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coin}`;
    const { data } = await axios.get(url, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
      },
    });

    const variation = data.market_data?.price_change_percentage_1h_in_currency?.usd;
    if (variation === undefined) return;

    console.log(`[${coin}] Variation 1h : ${variation.toFixed(2)} %`);

    if (Math.abs(variation) >= ALERT_VARIATION) {
      const title = `⚠️ ${coin.toUpperCase()} ${variation > 0 ? "↑" : "↓"} ${variation.toFixed(2)} %`;
      const msg = `${coin.toUpperCase()} a varié de ${variation.toFixed(2)} % en 1h.`;
      sendPush(title, msg);
    }
  } catch (e) {
    // silencieux
  }
}

// 📉 Funding Rate Bybit
async function checkFunding(coin) {
  try {
    const symbol = `${coin.toUpperCase()}USDT`;
    const url = `https://api.bybit.com/v5/market/funding/history?symbol=${symbol}&limit=1`;
    const res = await axios.get(url);
    const item = res.data.result.list?.[0];
    if (!item) return;

    const rate = parseFloat(item.fundingRate);
    console.log(`[${symbol}] Funding : ${(rate * 100).toFixed(4)} %`);

    if (rate < FUNDING_ALERT) {
      const title = `📉 ${symbol} Funding Alert`;
      const msg = `⚠️ ${symbol} ➤ Funding = ${(rate * 100).toFixed(4)} % → Trop de shorts`;
      sendPush(title, msg);
    }
  } catch (err) {
    // silencieux
  }
}

// 🔁 Boucle principale
async function runBot() {
  if (coinList.length === 0) {
    coinList = await getBybitCoins();
    console.log(`🧩 ${coinList.length} coins récupérés`);
  }

  for (const coin of coinList) {
    await checkVariation(coin);
    await checkFunding(coin);
  }
}

// 🕒 Lancement périodique
runBot();
setInterval(runBot, INTERVAL_MINUTES * 60 * 1000);

// 🔴 Liquidations live
async function startLiquidationWatcher() {
  try {
    const res = await axios.get("https://api.bybit.com/v5/market/instruments-info?category=linear");

    const pairs = res.data.result.list
      .filter((s) => s.symbol.endsWith("USDT"))
      .map((s) => `publicTrade.${s.symbol}`);

    console.log(`📡 Souscription aux liquidations : ${pairs.length} paires`);

    const ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");

    ws.on("open", () => {
      console.log("🔌 Connecté au flux WebSocket Bybit");
      ws.send(
        JSON.stringify({
          op: "subscribe",
          args: pairs.slice(0, 250), // max 250 canaux
        })
      );
    });

    ws.on("message", (data) => {
      try {
        const json = JSON.parse(data);
        const trades = json.data;
        if (!Array.isArray(trades)) return;

        for (const trade of trades) {
          const size = parseFloat(trade.v);
          const price = parseFloat(trade.p);
          const value = size * price;
          const pair = trade.s;

          if (value >= MIN_LIQUIDATION_USD) {
            const dir = trade.S === "Buy" ? "SHORTS 💥 liquidés" : "LONGS 🔥 liquidés";
            const msg = `💣 ${dir} : ${value.toLocaleString()} $ sur ${pair}\nPrix : ${price}`;
            console.log(msg);
            sendPush(`Liquidation ${pair}`, msg);
          }
        }
      } catch (err) {
        console.error("❌ WebSocket erreur parsing :", err.message);
      }
    });

    ws.on("error", (err) => {
      console.error("❌ WebSocket erreur :", err.message);
    });

    ws.on("close", () => {
      console.warn("⚠️ WebSocket fermé. Reconnexion dans 5 sec...");
      setTimeout(startLiquidationWatcher, 5000);
    });
  } catch (err) {
    console.error("❌ Erreur API instruments Bybit :", err.message);
  }
}

startLiquidationWatcher();

