var express = require('express');
var router = express.Router();

global.fetch = require('node-fetch');

var io = null;

var talib = require('ta-lib');
var CCI = require('technicalindicators').CCI,
 ATR = require('technicalindicators').ATR,
 VWAP = require('technicalindicators').VWAP,
 PSAR = require('technicalindicators').PSAR,
 WilliamsR = require('technicalindicators').WilliamsR,
 Stochastic = require('technicalindicators').Stochastic;

var fs = require('fs');

var SaveInfo = new Object();
 
const api = require('binance');
const binanceRest = new api.BinanceRest({
    key: 'GcxVK6sAzJ2lu2CKWg1qiVMe6qhEPy2JbLK9mpEZrP7iX8duYlvWEOY4aPv4FLDL', // Get this from your account on binance.com
    secret: 'NFURCamd05jWbAdj8eOGSC0qSh5hfhLsmPyxkAhzhxVT2dHh1ABiNXpJZxAZyRi7', // Same for this
    timeout: 15000, // Optional, defaults to 15000, is the request time out in milliseconds
    recvWindow: 10000, // Optional, defaults to 5000, increase if you're getting timestamp errors
    disableBeautification: false
    /*
     * Optional, default is false. Binance's API returns objects with lots of one letter keys.  By
     * default those keys will be replaced with more descriptive, longer ones.
     */
});
// Gather connection time
var connection_time = -1;
binanceRest.time().then((data)=>{
 connection_time = data.serverTime;
}).catch((err)=>{
 console.log(err);  
});
// Initialize stats-holder objects
var total_stats = new Object(),
 coins = ['TRXETH'],
 intervals = ['1m', '5m', '15m', '30m', '1h'],// '12h', '1d'],
 functions = ['MFI', 'CCI', 'WilliamsR', 'VWAP', 'AROON', 'PSAR'];
for(var x in coins){
 var coin = coins[x];
 total_stats[coin] = new Object();
 total_stats[coin].currentPrice = -1;
 total_stats[coin].swing = 0;
 total_stats[coin].lastBuy = -1;
 total_stats[coin].lastSell = -1;
 for(var i in intervals){
  var interval = intervals[i];
  total_stats[coin][interval] = new Object();
  for(var u in functions){
   var f = functions[u];
   total_stats[coin][interval][f] = new Object();
   total_stats[coin][interval][f].name = f;
   total_stats[coin][interval][f].status = 'null';
  }
 }
}

// Load saved data
LoadInformation();

function CoreLoop(){
 GetAllCoinStats('TRXETH');
}
setInterval(EmitStatus, 500);

function GetAllCoinStats(symbol){
 for(var i in intervals){
  var interval = intervals[i];
  GetCoinStats(symbol, interval);
 }
}

var period = 20; // Gives functions less data from the past. Makes them more responsive.
function GetCoinStats(symbol, interval){
 binanceRest.klines({'symbol':symbol, 'interval': interval}).then((data)=>{
  // Gather data
  var high = [], low = [], open = [], close = [], volume = [];
  for(var i = parseInt(data.length - period); i < data.length - 1; i++){
   var d = data[i];
   high.push(parseFloat(d.high));
   low.push(parseFloat(d.low));
   open.push(parseFloat(d.open));
   close.push(parseFloat(d.close));
   volume.push(parseFloat(d.volume));
  }
  var N = high.length
   currentPrice = data[data.length - 1].close;
  total_stats[symbol].currentPrice = currentPrice;
  // Feed data into functions
  for(var u in functions){
   var f = functions[u],
    v,
    s = total_stats[symbol][interval];
   switch(f){
    // MFI
    case('MFI'):
     v = talib.MFI(high, low, close, volume, N).toFixed(0);
     s[f].value = v;
     // Decide if status changed
     var status = 'null';
     // Overbought
     if(v >= 80 - 15){
      status = 'sell';
     }
     // Undersold
     else if(v < 20 + 15){
      status = 'buy';
     }
     DecideChange(symbol, interval, s[f], status);
     s[f].status = status;
     break;
    // WilliamsR
    case('WilliamsR'):
     v = parseFloat(WilliamsR.calculate({high: high, low: low, close: close, period: N})).toFixed(0);
     s[f].value = v;
     // Decide if status changed
     var status = 'null';
     // Overbought
     if(v >= - 20){
      status = 'sell';
     }
     // Undersold
     else if(v <= -80){
      status = 'buy';
     }
     DecideChange(symbol, interval, s[f], status);
     s[f].status = status;
     break;
    // VWAP
    case('VWAP'):
     v = VWAP.calculate({open: [], high: high, low: low, close: close, volume: volume});
     s[f].value = 0;
     for(var i = 0; i < v.length; i++){
      s[f].value += v[i];
     }
     s[f].value /= v.length;
     s[f].value = (parseFloat(s[f].value) - currentPrice).toFixed(8);
     v = s[f].value;
     // Decide if status changed
     var status = 'null';
     // Current price lower than preferred price
     if(v >= 0){
      status = 'buy';
     }
     DecideChange(symbol, interval, s[f], status);
     s[f].status = status;
     break;
    // CCI
    case('CCI'):
     v = parseFloat(CCI.calculate({open: open, high: high, low: low, close: close, period: N})).toFixed(0);
     s[f].value = v;
     // Decide if status changed
     var status = 'null';
     // Buy signal
     if(v >= 100){
      status = 'sell';
     }
     // Sell signal
     else if(v <= -100){
      status = 'buy';
     }
     DecideChange(symbol, interval, s[f], status);
     s[f].status = status;
     break;
   }
   total_stats[symbol][interval] = s;
  }
  /*/stats.AROON = talib.AROON(high, low, N);
  //stats.ATR = parseFloat(ATR.calculate({high: high, low: low, close: close, period: N}));
  //stats.PSAR = parseFloat(PSAR.calculate({high: high, low: low, step: 0.02, max: 0.2}));
  //stats.Stochastic = Stochastic.calculate({high: high, low: low, close: close, period: N, signalPeriod: 200});
  //console.log(stats.Stochastic);
  // Check PSAR
  if(PSAR > recent.close){
   addPSAR = 'downward )';
  }else{
   addPSAR = 'upward )';
  }*/
  }).catch((err)=>{
   console.log(err);
 });
}

const coin_trade_time = 1000 * 60; // Waits a minute in between trading
function BuyCoin(coinPair){
 // Parse coin
 var coin = coinPair.substring(0, 3);
 var currentPrice = total_stats[coinPair].currentPrice;
 // Check time
 var d = new Date();
 if(d.getTime() - total_stats[coinPair].lastBuy < coin_trade_time) {
  LogEvent('Buy trade refused at ' + currentPrice + ' ETH per TRX because trade is within ' + coin_trade_time * 1000 + ' seconds of last trade');
  return;
 }
 // Get amount can purchase
 var amount = SaveInfo.bank.ETH / currentPrice;
 // Buy % of that
 var purchaseAmount = parseInt(amount * 0.5);
 // Make sure has enough for a purchase
 if(currentPrice * purchaseAmount < 0.001) {
  LogEvent('Buy trade refused at ' + currentPrice + ' ETH per TRX because only has ' + SaveInfo.bank.ETH + ' ETH');
  return;
 }
 SaveInfo.bank[coin] += purchaseAmount;
 SaveInfo.bank.ETH -= parseFloat(purchaseAmount * currentPrice);
 // Record time
 total_stats[coinPair].lastBuy = d.getTime();
 RecordOrder(ORDERID++, 'TRXETH', 'BUY', currentPrice, purchaseAmount);
}

function SellCoin(coinPair){
 // Parse coin
 var coin = coinPair.substring(3);
 var currentPrice = total_stats[coinPair].currentPrice;
 // Check time
 var d = new Date();
 if(d.getTime() - total_stats[coinPair].lastSell < coin_trade_time) {
  LogEvent('Sell trade refused at ' + currentPrice + ' ETH per TRX because trade is within ' + coin_trade_time * 1000 + ' seconds of last trade');
  return;
 }
 // Make sure has enough for a purchase
 if(SaveInfo.bank[coin] * currentPrice < 0.001) {
  LogEvent('Sell trade refused at ' + currentPrice + ' ETH per TRX because only has ' + SaveInfo.bank[coin] + ' TRX');
  return;
 }
 // Sell % of coin
 var sellAmount = parseInt(SaveInfo.bank[coin] * 0.5);
 SaveInfo.bank[coin] -= sellAmount;
 SaveInfo.bank.ETH += sellAmount * currentPrice;
 // Record time
 total_stats[coinPair].lastSell = d.getTime();
 RecordOrder(ORDERID++, 'TRXETH', 'SELL', currentPrice, sellAmount);
}

function DecideChange(coinPair, interval, functionData, status){
 if(functionData.status != status){
  LogEvent(interval + ' ' + functionData.name + ' changed to ' + status);
  // Change swing
  switch(status){
   case('buy'):
    total_stats[coinPair].swing++;
      // Check if should buy
    if(total_stats[coinPair].swing > 2){
     BuyCoin(coinPair);
    }
    break;
   case('sell'):
    total_stats[coinPair].swing--;
    // Check if should sell
    if(total_stats[coinPair].swing < -2){
     SellCoin(coinPair);
    }
    break;
   case('null'):
    if(functionData.status == 'buy'){
     total_stats[coinPair].swing--;
    }else{
     total_stats[coinPair].swing++;
    }
    break;
  }
 } 
}

function LogEvent(e){
 // Get time
 var d = new Date();
 d.toLocaleTimeString(); 
 // LogEvent
 console.log(d + ': ' + e);
}

 // Prices to sell/buy at in ETH
console.log("======================");
console.log("Selected coin: TRX");
/*binanceRest.account().then((data)=>{
 for(var entry in data.balances){
  if(data.balances[entry].asset == 'TRX'){
   var coindata = data.balances[entry];
   BANK_TRX = coindata.free - START_TRX + 100; // Starting amount = 298; Amount given = 100
   console.log("Tron (TRX) amount available: " + BANK_TRX);
  }
  if(data.balances[entry].asset == 'ETH'){
   var coindata = data.balances[entry];
   BANK_ETH = coindata.free - START_ETH + 0.01033152; // Starting amount = 0.01033152; Amount given = 0.01033152
   console.log("Ethereum (ETH) amount available: " + BANK_ETH);
  }
 }
}).catch((err)=>{
 console.log(err);
});*/

// Use websocket for realtime updates
const binanceWS = new api.BinanceWS();
// Get trade info
binanceWS.onUserData(binanceRest, (data) => {
 console.log(data);
 if(data.eventType != 'executionReport')return;
 GetOpenOrders();
 if(data.orderStatus == 'NEW'){
  console.log('New ' + data.orderType + ' ' + data.side + ' order for ' + data.symbol + '. Price: ' + data.price + ' Quantity: ' + data.quantity + ' Total: ' + (data.price * data.quantity));
  return;
 }
 if(data.orderStatus == 'FILLED'){
  console.log('Filled ' + data.orderType + ' ' + data.side + ' order for ' + data.symbol + '. Price: ' + data.price + ' Quantity: ' + data.quantity + ' Total: ' + (data.price * data.quantity));
  return;
 }
 if(data.orderStatus == 'CANCELED'){
  console.log('Canceled ' + data.orderType + ' ' + data.side + ' order for ' + data.symbol + '. Price: ' + data.price + ' Quantity: ' + data.quantity + ' Total: ' + (data.price * data.quantity));
  return;
 }
});

var orders = new Object();
orders.completed = [];
/*GetOpenOrders();
function GetOpenOrders(){
 orders.open = [];
 binanceRest.openOrders('TRXETH', (err,data)=>{
  console.log('Open order: ');
  console.log(data);
  for(var i in data){
   orders.open.push(data[i]);
  }
 });
}*/

var ORDERID = 0;
function RecordOrder(orderId, symbol, side, price, quantity){
 var newOrder = new Object();
 newOrder.orderId = orderId;
 newOrder.symbol = symbol;
 newOrder.side = side;
 newOrder.price = price;
 newOrder.quantity = quantity;
 newOrder.total = price*quantity;
 // Get date
 var d = new Date();
 d.toLocaleTimeString(); 
 newOrder.date = d;
 // Save data
 orders.completed.push(newOrder);
 SaveInformation();
 // Update site
 EmitStatus();
}

function SaveInformation(){
 SaveInfo.orders = orders;
 var data = JSON.stringify(SaveInfo.orders);
 fs.writeFile('orders.txt', data, (err) => {
  if (err) throw err;
 }); 
 data = JSON.stringify(SaveInfo.bank);
 fs.writeFile('bank.txt', data, (err) => {
  if (err) throw err;
 }); 
}
// CALL THIS FUNCTION SOMETIME ----------------------------------------------------------------------------------------------------------------
function LoadInformation(){
 LogEvent('loading data');
 fs.readFile('orders.txt', (err, data) => {
  if (err) throw err;
  SaveInfo.orders = JSON.parse(data);
 });
 fs.readFile('bank.txt', (err, data) => {
  if (err) throw err;
  SaveInfo.bank = JSON.parse(data);
  
  CoreLoop();
  setInterval(CoreLoop, 1000 * 1);
 });
}

function EmitStatus(){
 if(io == null)return;
 var page = '';
 // Record bank
 page += GetWrappedElement('div', '<h1>TOTAL</h1><p>' + (SaveInfo.bank.ETH + (SaveInfo.bank.TRX * currentPrice)).toFixed(8) + 'ETH | ' + (SaveInfo.bank.TRX + (SaveInfo.bank.ETH / currentPrice)) + ' TRX</p><h1>ETH</h1><p>' + SaveInfo.bank.ETH + '</p><h1>TRX</h1><p>' + SaveInfo.bank.TRX + '</p><h1>Swing</h1><p>' + total_stats['TRXETH'].swing + '</p>', 'class="card"');
 // Create a card for each interval
 for(var i in intervals){
  var interval = intervals[i];
  // Parse function data
  var s = '<table width="100%" class="table"><tr>';
  // Add function names
  for(var u in functions){
   var f = functions[u];
   s += GetWrappedElement('th', GetWrappedElement('h3', f));
  }
  s += '</tr><tr>';
  // Record data
  for(var u in functions){
   var f = functions[u];
   // Change color of text based on function value; buy or sell
   var val = total_stats['TRXETH'][interval][f].status,
    color = 'black;font-weight: normal';
   if(val == 'buy'){
    color = 'red;font-weight: bold';
   }else if(val == 'sell'){
    color = 'green;font-weight: bold';
   }
   s += GetWrappedElement('td', GetWrappedElement('p', total_stats['TRXETH'][interval][f].value), 'style="color:' + color + ';"');
  }
  s += '</tr>';
  s = GetWrappedElement('h2', interval) + s + '</table>';
  page += GetWrappedElement('div', s, 'class="card" padding="10em"');
 }
 // Parse orders
 var parsedOrders = '<h1>Filled Trades</h1>';
 for(var i in orders.completed){
  var orderData = orders.completed[i];
  var l = GetWrappedElement('p', 'Order ID: ' + orderData.orderId)+
   GetWrappedElement('p', 'Time: ' + orderData.date)+
   GetWrappedElement('p', 'Pair: ' + orderData.symbol)+
   GetWrappedElement('p', 'Market: ' + orderData.side)+
   GetWrappedElement('p', 'Price: ' + orderData.price + ' ETH')+
   GetWrappedElement('p', 'Quantity: ' + orderData.quantity)+
   GetWrappedElement('p', 'Total: ' + orderData.total + ' ETH');
   parsedOrders += GetWrappedElement('div', l, 'class="card" style="width:20em;"');
 }
 page += parsedOrders;
 // Send page
 io.emit('webpage', page);
}

// Wrapper for writing HTML elements
function GetWrappedElement(element, contents){
 return ('<' + element + '>' + contents + '</' + element + '>');
}
function GetWrappedElement(element, contents, inline){
 return ('<' + element + ' ' + inline + '>' + contents + '</' + element + '>');
}

/* GET home page. */
router.get('/', function(req, res, next) {
 io = req.app.io;
 // Register events for new connection
 io.on('connection', function(socket){
  socket.on('changeSell', function(data){
  });
  socket.on('changeBuy', function(data){
  });
 });
 // Render bot.jade
 res.render('bot', { title: "CryptoBot" });
 // Send first-time data
 EmitStatus();
});

module.exports = router;