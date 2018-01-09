// Thomas Sullivan
// TODO:
// - Move back-end site sending via node to front-end

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
 Stochastic = require('technicalindicators').Stochastic,
 fs = require('fs'),
 api = require('binance'),
 binanceRest;

function InitBinanceAPI(){
 binanceRest = new api.BinanceRest({
  key: 'GcxVK6sAzJ2lu2CKWg1qiVMe6qhEPy2JbLK9mpEZrP7iX8duYlvWEOY4aPv4FLDL', 
  secret: 'NFURCamd05jWbAdj8eOGSC0qSh5hfhLsmPyxkAhzhxVT2dHh1ABiNXpJZxAZyRi7', 
  timeout: 15000,
  recvWindow: 10000, 
  disableBeautification: false
 });
}
InitBinanceAPI();

// OO Bot
function Bot(name){
 this.name = name;
 // Initialize coin/interval info
 this.coins = ['TRXETH', 'XRPETH', 'POEETH', 'FUNETH', 'ADAETH', 'XVGETH', 'REQETH', 'RCNETH', 'OSTETH', 'XLMETH', 'OMGETH', 'NEOETH', 'ICXETH'];
 this.intervals = ['1m', '5m', '15m', '30m', '1h'];
 this.functions = ['MFI', 'CCI', 'WilliamsR', 'VWAP'];
 this.period = 15; // Amount of data passed to functions. Less data makes them more responsive.
 this.swingThresh = [9, 5];
 // Function to save/record orders
 this.RecordOrder = function(orderId, symbol, side, price, quantity){
  var newOrder = new Object();
  newOrder.orderId = this.orders.ORDERID;
  newOrder.symbol = symbol;
  newOrder.side = side;
  newOrder.price = price;
  newOrder.quantity = quantity;
  newOrder.total = price*quantity;
  newOrder.swing = this.total_stats[symbol].swing;
  // Get date
  var d = new Date();
  d.toLocaleTimeString(); 
  newOrder.date = d;
  // Save new order + bank
  this.orders.completed.push(newOrder);
  this.LogEvent(side + ' trade ID ' + orderId + ' completed for ' + symbol + ' at ' + parseFloat(price).toFixed(8) + ' ETH for ' + parseFloat(quantity).toFixed(0) + ' ' + symbol.substring(0,3) + ' for a total of ' + parseFloat(price*quantity).toFixed(8) + ' ETH');
  var data = JSON.stringify(this.orders);
  fs.writeFile('bot_info/' + name + '/orders.txt', data, (err) => {
   if (err) throw err;
  }); 
  data = JSON.stringify(this.bank);
  fs.writeFile('bot_info/' + name + '/bank.txt', data, (err) => {
   if (err) throw err;
  }); 
 };
 // Buy coin
 this.BuyCoin = function(coinPair){
  if(!buying) return;
  // Parse coin
  var coin = coinPair.substring(0, 3);
  var currentPrice = this.total_stats[coinPair].currentPrice;
  // Check time
  var d = new Date();
  if(d.getTime() - this.total_stats[coinPair].lastBuy < coin_trade_time) {
   //this.LogEvent('Buy trade refused at ' + currentPrice + ' ETH per ' + coin + ' because trade is within ' + coin_trade_time / 1000 + ' seconds of last trade; specifically ' + (d.getTime() - this.total_stats[coinPair].lastBuy) / 1000 + ' seconds');
   return;
  }
  // Get amount can purchase
  var amount = this.bank.ETH / currentPrice;
  // Buy % of that
  var purchaseAmount = parseInt(BUY_AMOUNT / currentPrice);
  // Make sure purchase is not too large
  if(currentPrice * purchaseAmount > max_buy || currentPrice * purchaseAmount > this.bank.ETH) {
   //this.LogEvent('Buy trade limiting because price over max_buy or more than has');
   while(currentPrice * purchaseAmount > max_buy  || currentPrice * purchaseAmount > this.bank.ETH){
    purchaseAmount--;
   }
  }
  // Make sure has enough for a purchase
  if(currentPrice * purchaseAmount < min_buy) {
   //this.LogEvent('Buy trade refused at ' + currentPrice + ' ETH per ' + coin + ' because only has ' + this.bank.ETH + ' ETH');
   return;
  }
  this.bank[coin].push({amount: purchaseAmount, price: currentPrice});
  this.bank.ETH -= purchaseAmount * currentPrice;
  // Record time
  this.total_stats[coinPair].lastBuy = d.getTime();
  this.RecordOrder(this.orders.ORDERID++, coinPair, 'BUY', currentPrice, purchaseAmount);
 };
 // Sell coin
 this.SellCoin = function(coinPair){
  if(!selling) return;
  // Parse coin
  var coin = coinPair.substring(0, 3);
  var currentPrice = this.total_stats[coinPair].currentPrice;
  // Check time
  var d = new Date();
  if(d.getTime() - this.total_stats[coinPair].lastSell < coin_trade_time) {
   //this.LogEvent('Sell trade refused at ' + currentPrice + ' ETH per ' + coin + ' because trade is within ' + coin_trade_time / 1000 + ' seconds of last trade; specifically ' + (d.getTime() - this.total_stats[coinPair].lastSell) / 1000 + ' seconds');
   return;
  }
  // Make sure has some of the coin
  if(this.bank[coin].length == 0) return;
  // Check to see if there is coin order that can make profit from
  var iter = -1
  while(true){
   var lastPrice = currentPrice, 
    sellDistance = 0.005; // Min profit allowed to sell in ETH
   for(var i in this.bank[coin]){
    // Checking to maximize profit; sell the coin bought for the least amount
    if(currentPrice != lastPrice){
     if(this.bank[coin][i].price - lastPrice > 0){
      lastPrice = this.bank[coin][i].price;
      iter = i;
     }
    }
    // Check to see if any profit can be made
    else if(this.bank[coin][i].price - lastPrice > sellDistance){
     lastPrice = this.bank[coin][i].price;
     iter = i;
    }
   }
   // Check to make sure found a match
   if(iter == -1) break;
   // Make sure sale is not too large
   var sellAmount = this.bank[coin][iter].amount;
   // Make sure has enough for a purchase
   if(sellAmount * currentPrice < min_sell) {
    //this.LogEvent('Sell trade refused at ' + currentPrice + ' ETH per ' + coin + ' because only has ' + this.bank[coin] + ' ' + coin);
    return;
   }
   // Sell % of coin
   this.bank[coin].splice(iter, 1);
   this.bank.ETH += sellAmount * currentPrice;
   // Record time
   this.total_stats[coinPair].lastSell = d.getTime();
   this.RecordOrder(this.orders.ORDERID++, coinPair, 'SELL', currentPrice, sellAmount);
  }
 };
 // Decide whether to buy/sell
 this.DecideChange = function(coinPair, interval, functionData, status){
  if(functionData.status != status){
   //this.LogEvent(interval + ' ' + functionData.name + ' changed to ' + status);
   // Change swing
   switch(status){
    case('buy'):
     this.total_stats[coinPair].swing++;
       // Check if should buy
     if(this.total_stats[coinPair].swing >= this.swingThresh[0]){
      this.BuyCoin(coinPair);
     }
     if(functionData.status == 'sell'){
      this.total_stats[coinPair].swing++;
     }
     break;
    case('sell'):
     this.total_stats[coinPair].swing--;
     // Check if should sell
     if(this.total_stats[coinPair].swing <= -this.swingThresh[1]){
      this.SellCoin(coinPair);
     }
     if(functionData.status == 'buy'){
      this.total_stats[coinPair].swing--;
     }
     break;
    case('null'):
     if(functionData.status == 'buy'){
      this.total_stats[coinPair].swing--;
     }else{
      this.total_stats[coinPair].swing++;
     }
     break;
   }
  } 
 };
 // Get stats for all coins
 this.GetAllCoinStats = function(symbol){
  for(var i in this.intervals){
   const interval = this.intervals[i];
   this.GetCoinStats(symbol, interval);
  }
 };
 // Get stats for a single coin
 this.GetCoinStats = function(symbol, interval){
  binanceRest.klines({'symbol':symbol, 'interval': interval}).then((data)=>{
   // Gather data
   var high = [], low = [], open = [], close = [], volume = [];
   for(var i = parseInt(data.length - this.period); i < data.length - 1; i++){
    var d = data[i];
    high.push(parseFloat(d.high));
    low.push(parseFloat(d.low));
    open.push(parseFloat(d.open));
    close.push(parseFloat(d.close));
    volume.push(parseFloat(d.volume));
   }
   var N = high.length
    currentPrice = data[data.length - 1].close;
   this.total_stats[symbol].currentPrice = currentPrice;
   // Feed data into functions
   for(var u in this.functions){
    var f = this.functions[u],
     v,
     s = this.total_stats[symbol][interval];
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
      this.DecideChange(symbol, interval, s[f], status);
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
      this.DecideChange(symbol, interval, s[f], status);
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
      this.DecideChange(symbol, interval, s[f], status);
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
      this.DecideChange(symbol, interval, s[f], status);
      s[f].status = status;
      break;
    }
    this.total_stats[symbol][interval] = s;
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
    this.LogEvent(symbol + ' : ' + err);
    if(err.substring(0, 6) == '<html>'){
     this.LogEvent('Caught 403; attempting to fix');
     InitBinanceAPI();
    }
  });
 };
 // Start bot using a function that will loop using setInterval()
 this.Loop = function(){
  for(var i in this.coins)
   this.GetAllCoinStats(this.coins[i]);
 }; 
 this.Start = function(){
  // Initialize stats object to hold function data
  this.total_stats = new Object();
  this.bank = new Object();
  this.orders = new Object();
  for(var x in this.coins){
   const coin = this.coins[x];
   this.total_stats[coin] = new Object();
   this.total_stats[coin].currentPrice = -1;
   this.total_stats[coin].swing = 0;
   this.total_stats[coin].lastBuy = -1;
   this.total_stats[coin].lastSell = -1;
   for(var i in this.intervals){
    const interval = this.intervals[i];
    this.total_stats[coin][interval] = new Object();
    for(var u in this.functions){
     const f = this.functions[u];
     this.total_stats[coin][interval][f] = new Object();
     this.total_stats[coin][interval][f].name = f;
     this.total_stats[coin][interval][f].status = 'null';
    }
   }
  }
  // Load saved bot info; bank and orders
  try{
   fs.mkdirSync('bot_info');
  }catch(err){}
  var dir = 'bot_info/' + name;
  try{
   fs.mkdirSync(dir);
  }catch(err){}
  fs.readFile(dir + '/orders.txt', (err, data) => {
   // Make new file if does not exist
   if (err) {
    this.orders.completed = [];
    this.orders.ORDERID = 0;
    var stream = fs.createWriteStream(dir + '/orders.txt');
    stream.write(JSON.stringify(this.orders));
    stream.end();
    /*fs.writeFile(dir + '/orders.txt', JSON.stringify(this.orders), (err) => {
     if (err) throw err;
    });*/ 
   }else{
    this.orders = JSON.parse(data);
    // Get last order ID
    if(this.orders.completed == null || this.orders.completed.length == 0) this.orders.ORDERID = 0;
    else this.orders.ORDERID = this.orders.ORDERID;
   }
  });
  fs.readFile(dir + '/bank.txt', (err, data) => {
   // If file does not exist, create
   if (err) {
    // Create new bank based on coins
    this.bank.ETH = 0.2;
    for(var i in this.coins){
     var parsedCoin = this.coins[i].substring(0, 3);
     this.bank[parsedCoin] = [];
    }
    var stream = fs.createWriteStream(dir + '/bank.txt');
    stream.write(JSON.stringify(this.bank));
    stream.end();
   }
   else {
    this.bank = JSON.parse(data);
    // Check to make sure all coins in bank
    for(var i in this.coins){
     var parsedCoin = this.coins[i].substring(0, 3);
     if(!this.bank[parsedCoin]){
      this.bank[parsedCoin] = [];
     }
    }
   }
  });
  // Start polling
   var _t = this;
   setInterval(function(){_t.Loop();}, 1000 * 30);
   setInterval(EmitStatus, 2500);
  };
 // Logger
 this.LogEvent = function(e){
  // Get time
  var d = new Date();
  d.toLocaleTimeString(); 
  // LogEvent
  console.log(this.name + ' - ' + d + ': ' + e);
 };
 // Get web info
 this.ParseIntoHTML = function(){
  var html = '';
  // Get total bank value in ETH
  var total = this.bank.ETH;
  for(var i in this.coins){
   var parsedCoin = this.coins[i].substring(0, 3);
   var coinTotal = 0;
   for(var u in this.bank[parsedCoin]){
    coinTotal += this.bank[parsedCoin].amount;
   }
   total += (coinTotal * this.total_stats[this.coins[i]].currentPrice);
  }
  // Add header for bot name
  html += GetWrappedElement('div', GetWrappedElement('h1', 'Bot: ' + this.name + ' - ' + total.toFixed(8) + ' ETH'), 'class="card-header"');
  html += GetWrappedElement('h2', 'Bank');
  // Display coin amounts
  html += '<table style="width:100%" class="table table-striped"><tr><th>Coin</th><th>Amount</th><th>Swing</th></tr><tr>';
  html += GetWrappedElement('td', 'ETH');
  html += GetWrappedElement('td', this.bank.ETH.toFixed(8));
  html += GetWrappedElement('td', '-');
  html += '</tr><tr>';
  for(var i in this.coins){
   var parsedCoin = this.coins[i].substring(0, 3);
   html += GetWrappedElement('td', parsedCoin);
   var coinTotal = 0;
   for(var u in this.bank[parsedCoin]){
    coinTotal += this.bank[parsedCoin].amount;
   }
   html += GetWrappedElement('td', coinTotal);
   html += GetWrappedElement('td', this.total_stats[this.coins[i]].swing);
   html += '</tr><tr>'
  }
  html += '</tr></table>';
  // Display completed orders
  html += GetWrappedElement('h2', GetWrappedElement('a', 'Filled Trades'));//, 'href="#' + this.name + '_orders" class="collapsed" data-toggle="collapse"'));
  var orders = '';
  for(var i in this.orders.completed){
   var orderData = this.orders.completed[i];
   var l = GetWrappedElement('div', GetWrappedElement('p', 'Order ID: ' + orderData.orderId), 'class="card-header"')+
    GetWrappedElement('div',
    GetWrappedElement('p', 'Time: ' + orderData.date)+
    GetWrappedElement('p', 'Pair: ' + orderData.symbol)+
    GetWrappedElement('p', 'Market: ' + orderData.side)+
    GetWrappedElement('p', 'Price: ' + parseFloat(orderData.price).toFixed(8) + ' ETH')+
    GetWrappedElement('p', 'Quantity: ' + orderData.quantity)+
    GetWrappedElement('p', 'Total: ' + orderData.total.toFixed(8) + ' ETH')+
    GetWrappedElement('p', 'Swing: ' + orderData.swing),
    'card-body');
    orders += GetWrappedElement('div', l, 'class="card border-light mb-3" style="width:20em;"');
  }
  html += GetWrappedElement('div', orders);//, 'id="' + this.name + '_orders" class="collapse"');
  // Send HTML
  return html;
 };
}

var bot0 = new Bot('bot0');

var bot1= new Bot('bot1');
bot1.period = 5;

var bot2 = new Bot('bot2');
bot2.intervals = ['1m', '5m', '15m'];
bot2.swingThresh = [5, 3];

var bot3 = new Bot('bot3');
bot3.intervals = ['1m'];
bot3.swingThresh = [2, 2];

bot0.Start();
bot1.Start();
bot2.Start();
bot3.Start();

const coin_trade_time = 1000 * 60 * 15, // Waits 15 minutes in between trading. Separate for buying/selling for each coin
 // Trade limits in ETH
 buying = true, min_buy = 0.01, max_buy = 0.05, BUY_AMOUNT = 0.03,
 selling = true, min_sell = 0.01, max_sell = 0.05, SELL_AMOUNT = 0.03;



// Get available amounts to trade
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

/*/ Use websocket for realtime updates
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
});*/

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

function EmitStatus(){
 if(io == null)return;
 /*var page = '';
 // Record bank
 page += GetWrappedElement('div', '<h1>TOTAL</h1><p>' + (SaveInfo.bank.ETH + (SaveInfo.bank.TRX * currentPrice)).toFixed(8) + ' ETH | ' + (SaveInfo.bank.TRX + (SaveInfo.bank.ETH / currentPrice)) + ' TRX</p><h1>ETH</h1><p>' + SaveInfo.bank.ETH + '</p><h1>TRX</h1><p>' + SaveInfo.bank.TRX.toFixed(0) + '</p><h1>Swing</h1><p>' + total_stats['TRXETH'].swing + '</p>', 'class="card"');
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
    color = 'black;font-weight: bold';
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
 }*/
 // Send page
 var htmls = [ bot0.ParseIntoHTML(), bot1.ParseIntoHTML(), bot2.ParseIntoHTML(), bot3.ParseIntoHTML() ],
  html = '';
 for(var i in htmls){
  var data = GetWrappedElement('td', GetWrappedElement('div', htmls[i], 'class="card border-light mb-3"'));
  if(i % 2 == 0){
   html += '<div class="card-group">' + data;
  }else{
   html += data + '</div>';
  }
 }
 io.emit('webpage', html);
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
 // Render bot.jade
 res.render('bot', { title: "CryptoBot" });
 // Send first-time data
 //EmitStatus();
});

module.exports = router;