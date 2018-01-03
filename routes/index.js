var express = require('express');
var router = express.Router();

global.fetch = require('node-fetch');
const cc = require('cryptocompare');

var coins = ['BTC', 'ETH', 'LTC', 'TRX', 'FUN', 'XRP', 'IOT', 'XLM', 'ETN', 'ADA', 'XVG'];
var coinData = [];
// Push initial data to be added upon later
for(var i = 0; i < coins.length; i++){
 var newCoin = new Object();
 newCoin.name = coins[i];
 coinData.push(newCoin);
}

var io = null;

// Get all coins prices
function GetCoinPrice(coin){
 var currentCoin = coinData.find(function(Coin){
  if(Coin.name == coin) return Coin;
 });
 cc.priceFull(coin, 'USD')
 .then(data => {
  var minData = data[coin].USD;
  currentCoin.price = minData.PRICE;
 })
 .catch(console.error)
 var d = new Date();
 cc.priceHistorical(coin, 'USD', new Date((d.getMonth()+1)+"-"+(d.getDate()-1)+"-"+d.getFullYear()))
 .then(data => {
  currentCoin.price24Hours = data.USD;
 })
 .catch(console.error)
}

function GetCoinPrices(){
 for(var i = 0; i < coins.length; i++){
  GetCoinPrice(coins[i]);
 }
 if(io == null){
  return;
 }
 io.emit('pricesSend', coinData);
}
// Start loading coinData every 5000 milliseconds
//GetCoinPrices();
//setInterval(GetCoinPrices, 5000);

/* GET home page. */
router.get('/', function(req, res, next) {
 io = req.app.io;
 
 res.render('index', { title: "CryptoCompare" });
});

module.exports = router;
