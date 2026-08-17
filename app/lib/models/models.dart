/// Shared data models for the VARUN TEJ app. All values come from the backend.

class User {
  final int id;
  final String email;
  final String phone;
  final String username;
  final String name;
  final String profilePic;
  final bool biometricEnabled;
  final bool securityPinSet;

  const User({
    required this.id,
    required this.email,
    required this.phone,
    required this.username,
    required this.name,
    required this.profilePic,
    required this.biometricEnabled,
    required this.securityPinSet,
  });

  factory User.fromJson(Map<String, dynamic> j) => User(
        id: (j['id'] as num?)?.toInt() ?? 0,
        email: j['email'] as String? ?? '',
        phone: j['phone'] as String? ?? '',
        username: j['username'] as String? ?? '',
        name: j['name'] as String? ?? '',
        profilePic: j['profile_pic'] as String? ?? '',
        biometricEnabled: j['biometric_enabled'] == 1 || j['biometric_enabled'] == true,
        securityPinSet: j['security_pin_set'] == 1 || j['security_pin_set'] == true,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'phone': phone,
        'username': username,
        'name': name,
        'profile_pic': profilePic,
        'biometric_enabled': biometricEnabled,
        'security_pin_set': securityPinSet,
      };
}

class Quote {
  final String symbol;
  final String token;
  final String exchange;
  final double ltp;
  final double open;
  final double high;
  final double low;
  final double close;
  final double netchange;
  final double percentChange;
  final double volume;
  final double oi;
  final String lastTradedTime;
  final String? error;

  const Quote({
    this.symbol = '',
    this.token = '',
    this.exchange = '',
    this.ltp = 0,
    this.open = 0,
    this.high = 0,
    this.low = 0,
    this.close = 0,
    this.netchange = 0,
    this.percentChange = 0,
    this.volume = 0,
    this.oi = 0,
    this.lastTradedTime = '',
    this.error,
  });

  factory Quote.fromJson(Map<String, dynamic> j) {
    if (j.containsKey('error')) return Quote(error: j['error'] as String?);
    return Quote(
      symbol: j['symbol'] as String? ?? '',
      token: j['token'] as String? ?? '',
      exchange: j['exchange'] as String? ?? '',
      ltp: (j['ltp'] as num?)?.toDouble() ?? 0,
      open: (j['open'] as num?)?.toDouble() ?? 0,
      high: (j['high'] as num?)?.toDouble() ?? 0,
      low: (j['low'] as num?)?.toDouble() ?? 0,
      close: (j['close'] as num?)?.toDouble() ?? 0,
      netchange: (j['netchange'] as num?)?.toDouble() ?? 0,
      percentChange: (j['percentChange'] as num?)?.toDouble() ?? 0,
      volume: (j['volume'] as num?)?.toDouble() ?? 0,
      oi: (j['oi'] as num?)?.toDouble() ?? 0,
      lastTradedTime: j['lastTradedTime'] as String? ?? '',
    );
  }
}

class Indices {
  final Quote nifty;
  final Quote sensex;
  final Quote banknifty;

  const Indices({required this.nifty, required this.sensex, required this.banknifty});

  factory Indices.fromJson(Map<String, dynamic> j) => Indices(
        nifty: Quote.fromJson(j['nifty'] as Map<String, dynamic>? ?? {}),
        sensex: Quote.fromJson(j['sensex'] as Map<String, dynamic>? ?? {}),
        banknifty: Quote.fromJson(j['banknifty'] as Map<String, dynamic>? ?? {}),
      );
}

class Gainer {
  final String symbol;
  final String token;
  final double ltp;
  final double netchange;
  final double percentChange;
  final String? strike;
  final String? expiry;
  final String? optionType;
  final String exchange;

  const Gainer({
    required this.symbol,
    required this.token,
    required this.ltp,
    required this.netchange,
    required this.percentChange,
    this.strike,
    this.expiry,
    this.optionType,
    required this.exchange,
  });

  factory Gainer.fromJson(Map<String, dynamic> j) => Gainer(
        symbol: j['symbol'] as String? ?? '',
        token: j['token'] as String? ?? '',
        ltp: (j['ltp'] as num?)?.toDouble() ?? 0,
        netchange: (j['netchange'] as num?)?.toDouble() ?? 0,
        percentChange: (j['percentChange'] as num?)?.toDouble() ?? 0,
        strike: j['strike'] as String?,
        expiry: j['expiry'] as String?,
        optionType: j['optionType'] as String?,
        exchange: j['exchange'] as String? ?? 'NSE',
      );
}

class Trade {
  final int id;
  final String kind; // stock | option
  final String symbol;
  final String instrument;
  final String signal; // BUY | WATCH | AVOID
  final String entryZone;
  final String target;
  final String stopLoss;
  final String timeframe;
  final String risk;
  final int confidence;
  final String reason;
  final String status;
  final bool highConfidence;
  final String createdAt;

  const Trade({
    required this.id,
    required this.kind,
    required this.symbol,
    required this.instrument,
    required this.signal,
    required this.entryZone,
    required this.target,
    required this.stopLoss,
    required this.timeframe,
    required this.risk,
    required this.confidence,
    required this.reason,
    required this.status,
    required this.highConfidence,
    required this.createdAt,
  });

  factory Trade.fromJson(Map<String, dynamic> j) => Trade(
        id: (j['id'] as num?)?.toInt() ?? 0,
        kind: j['kind'] as String? ?? 'stock',
        symbol: j['symbol'] as String? ?? '',
        instrument: j['instrument'] as String? ?? '',
        signal: j['signal'] as String? ?? 'AVOID',
        entryZone: j['entry_zone'] as String? ?? '',
        target: j['target'] as String? ?? '',
        stopLoss: j['stop_loss'] as String? ?? '',
        timeframe: j['timeframe'] as String? ?? '',
        risk: j['risk'] as String? ?? 'medium',
        confidence: (j['confidence'] as num?)?.toInt() ?? 0,
        reason: j['reason'] as String? ?? '',
        status: j['status'] as String? ?? 'ACTIVE',
        highConfidence: j['high_confidence'] == 1 || j['high_confidence'] == true,
        createdAt: j['created_at'] as String? ?? '',
      );
}

class Analysis {
  final int id;
  final String kind; // stock | option
  final String symbol;
  final String currentPrice;
  final String marketTrend;
  final String newsSentiment;
  final String aiSignal;
  final String target;
  final String stopLoss;
  final String timeframe;
  final String risk;
  final int confidence;
  final String reason;
  final String createdAt;

  const Analysis({
    required this.id,
    required this.kind,
    required this.symbol,
    required this.currentPrice,
    required this.marketTrend,
    required this.newsSentiment,
    required this.aiSignal,
    required this.target,
    required this.stopLoss,
    required this.timeframe,
    required this.risk,
    required this.confidence,
    required this.reason,
    required this.createdAt,
  });

  factory Analysis.fromJson(Map<String, dynamic> j) => Analysis(
        id: (j['id'] as num?)?.toInt() ?? 0,
        kind: j['kind'] as String? ?? 'stock',
        symbol: j['symbol'] as String? ?? '',
        currentPrice: j['current_price'] as String? ?? '',
        marketTrend: j['market_trend'] as String? ?? '',
        newsSentiment: j['news_sentiment'] as String? ?? '',
        aiSignal: j['ai_signal'] as String? ?? '',
        target: j['target'] as String? ?? '',
        stopLoss: j['stop_loss'] as String? ?? '',
        timeframe: j['timeframe'] as String? ?? '',
        risk: j['risk'] as String? ?? 'medium',
        confidence: (j['confidence'] as num?)?.toInt() ?? 0,
        reason: j['reason'] as String? ?? '',
        createdAt: j['created_at'] as String? ?? '',
      );
}

class AppNotification {
  final int id;
  final String type;
  final String title;
  final String body;
  final bool read;
  final String createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.read,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: (j['id'] as num?)?.toInt() ?? 0,
        type: j['type'] as String? ?? '',
        title: j['title'] as String? ?? '',
        body: j['body'] as String? ?? '',
        read: j['read'] == 1 || j['read'] == true,
        createdAt: j['created_at'] as String? ?? '',
      );
}

class AiKey {
  final int id;
  final int work;
  final int slot;
  final String provider;
  final String model;
  final String keyHint;
  final String status;
  final String lastError;
  final String lastTestedAt;
  final bool enabled;

  const AiKey({
    required this.id,
    required this.work,
    required this.slot,
    required this.provider,
    required this.model,
    required this.keyHint,
    required this.status,
    required this.lastError,
    required this.lastTestedAt,
    required this.enabled,
  });

  factory AiKey.fromJson(Map<String, dynamic> j) => AiKey(
        id: (j['id'] as num?)?.toInt() ?? 0,
        work: (j['work'] as num?)?.toInt() ?? 1,
        slot: (j['slot'] as num?)?.toInt() ?? 1,
        provider: j['provider'] as String? ?? 'google',
        model: j['model'] as String? ?? '',
        keyHint: j['key_hint'] as String? ?? '',
        status: j['status'] as String? ?? 'UNKNOWN',
        lastError: j['last_error'] as String? ?? '',
        lastTestedAt: j['last_tested_at'] as String? ?? '',
        enabled: j['enabled'] == 1 || j['enabled'] == true,
      );
}

class AiModel {
  final int id;
  final String provider;
  final String model;
  final String endpoint;
  final String keyHint;
  final String status;
  final String verifiedAt;
  final bool isPrimary;
  final bool enabled;
  final String lastError;
  final String lastErrorCategory;
  final int latencyMs;

  const AiModel({
    required this.id,
    required this.provider,
    required this.model,
    required this.endpoint,
    required this.keyHint,
    required this.status,
    required this.verifiedAt,
    required this.isPrimary,
    required this.enabled,
    required this.lastError,
    required this.lastErrorCategory,
    required this.latencyMs,
  });

  factory AiModel.fromJson(Map<String, dynamic> j) => AiModel(
        id: (j['id'] as num?)?.toInt() ?? 0,
        provider: j['provider'] as String? ?? '',
        model: j['model'] as String? ?? '',
        endpoint: j['endpoint'] as String? ?? '',
        keyHint: j['key_hint'] as String? ?? '',
        status: j['status'] as String? ?? 'VERIFICATION_REQUIRED',
        verifiedAt: j['verified_at'] as String? ?? '',
        isPrimary: j['is_primary'] == 1 || j['is_primary'] == true,
        enabled: j['enabled'] == 1 || j['enabled'] == true,
        lastError: j['last_error'] as String? ?? '',
        lastErrorCategory: j['last_error_category'] as String? ?? '',
        latencyMs: (j['latency_ms'] as num?)?.toInt() ?? 0,
      );
}

class InstrumentSearchResult {
  final String type; // stock | option | index
  final String symbol;
  final String token;
  final String exchange;

  const InstrumentSearchResult({
    required this.type,
    required this.symbol,
    required this.token,
    required this.exchange,
  });

  factory InstrumentSearchResult.fromJson(Map<String, dynamic> j) => InstrumentSearchResult(
        type: j['type'] as String? ?? 'stock',
        symbol: j['symbol'] as String? ?? '',
        token: j['token'] as String? ?? '',
        exchange: j['exchange'] as String? ?? 'NSE',
      );
}

class NewsArticle {
  final int id;
  final String source;
  final String title;
  final String url;
  final String publishedAt;

  const NewsArticle({
    required this.id,
    required this.source,
    required this.title,
    required this.url,
    required this.publishedAt,
  });

  factory NewsArticle.fromJson(Map<String, dynamic> j) => NewsArticle(
        id: (j['id'] as num?)?.toInt() ?? 0,
        source: j['source'] as String? ?? '',
        title: j['title'] as String? ?? '',
        url: j['url'] as String? ?? '',
        publishedAt: j['published_at'] as String? ?? '',
      );
}

class AnalysisJob {
  final String status;
  final String message;
  final double? progress;
  final Map<String, dynamic>? report;

  const AnalysisJob({
    required this.status,
    required this.message,
    this.progress,
    this.report,
  });

  factory AnalysisJob.fromJson(Map<String, dynamic> j) => AnalysisJob(
        status: j['status'] as String? ?? '',
        message: j['message'] as String? ?? '',
        progress: (j['progress'] as num?)?.toDouble(),
        report: j['report'] as Map<String, dynamic>?,
      );
}

/// One daily candlestick (live graph data from Angel One).
class Candle {
  final String time;
  final double open;
  final double high;
  final double low;
  final double close;
  final double volume;

  const Candle({
    required this.time,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    required this.volume,
  });

  bool get bullish => close >= open;

  factory Candle.fromJson(Map<String, dynamic> j) => Candle(
        time: j['time'] as String? ?? '',
        open: (j['open'] as num?)?.toDouble() ?? 0,
        high: (j['high'] as num?)?.toDouble() ?? 0,
        low: (j['low'] as num?)?.toDouble() ?? 0,
        close: (j['close'] as num?)?.toDouble() ?? 0,
        volume: (j['volume'] as num?)?.toDouble() ?? 0,
      );
}

/// Full instrument view for the detail screens (quote + ranges + fundamentals).
class InstrumentDetails {
  final String symbol;
  final String kind; // stock | option
  final String exchange;
  final Quote quote;
  final TodayRange today;
  final Week52Range? week52;
  final Fundamentals fundamentals;

  const InstrumentDetails({
    required this.symbol,
    required this.kind,
    required this.exchange,
    required this.quote,
    required this.today,
    this.week52,
    required this.fundamentals,
  });

  factory InstrumentDetails.fromJson(Map<String, dynamic> j) => InstrumentDetails(
        symbol: j['symbol'] as String? ?? '',
        kind: j['kind'] as String? ?? 'stock',
        exchange: j['exchange'] as String? ?? 'NSE',
        quote: Quote.fromJson(j['quote'] as Map<String, dynamic>? ?? {}),
        today: TodayRange.fromJson(j['today'] as Map<String, dynamic>? ?? {}),
        week52: j['week52'] != null ? Week52Range.fromJson(j['week52'] as Map<String, dynamic>) : null,
        fundamentals: Fundamentals.fromJson(j['fundamentals'] as Map<String, dynamic>? ?? {}),
      );
}

class TodayRange {
  final double open;
  final double high;
  final double low;
  final double ltp;
  final double netchange;
  final double percentChange;

  const TodayRange({
    required this.open,
    required this.high,
    required this.low,
    required this.ltp,
    required this.netchange,
    required this.percentChange,
  });

  factory TodayRange.fromJson(Map<String, dynamic> j) => TodayRange(
        open: (j['open'] as num?)?.toDouble() ?? 0,
        high: (j['high'] as num?)?.toDouble() ?? 0,
        low: (j['low'] as num?)?.toDouble() ?? 0,
        ltp: (j['ltp'] as num?)?.toDouble() ?? 0,
        netchange: (j['netchange'] as num?)?.toDouble() ?? 0,
        percentChange: (j['percentChange'] as num?)?.toDouble() ?? 0,
      );
}

class Week52Range {
  final double high;
  final double low;
  final double rangePosition; // 0-100, where current price sits in the 52w range

  const Week52Range({required this.high, required this.low, required this.rangePosition});

  factory Week52Range.fromJson(Map<String, dynamic> j) => Week52Range(
        high: (j['high'] as num?)?.toDouble() ?? 0,
        low: (j['low'] as num?)?.toDouble() ?? 0,
        rangePosition: (j['rangePosition'] as num?)?.toDouble() ?? 0,
      );
}

class Fundamentals {
  final double previousClose;
  final double lowerCircuit;
  final double upperCircuit;
  final double volume;
  final double buyQuantity;
  final double sellQuantity;
  final double openInterest;
  final String lastTradedTime;

  const Fundamentals({
    required this.previousClose,
    required this.lowerCircuit,
    required this.upperCircuit,
    required this.volume,
    required this.buyQuantity,
    required this.sellQuantity,
    required this.openInterest,
    required this.lastTradedTime,
  });

  factory Fundamentals.fromJson(Map<String, dynamic> j) => Fundamentals(
        previousClose: (j['previousClose'] as num?)?.toDouble() ?? 0,
        lowerCircuit: (j['lowerCircuit'] as num?)?.toDouble() ?? 0,
        upperCircuit: (j['upperCircuit'] as num?)?.toDouble() ?? 0,
        volume: (j['volume'] as num?)?.toDouble() ?? 0,
        buyQuantity: (j['buyQuantity'] as num?)?.toDouble() ?? 0,
        sellQuantity: (j['sellQuantity'] as num?)?.toDouble() ?? 0,
        openInterest: (j['openInterest'] as num?)?.toDouble() ?? 0,
        lastTradedTime: j['lastTradedTime'] as String? ?? '',
      );
}

/// One entry from the News API request history (Settings -> News API History).
class NewsHistoryEntry {
  final int id;
  final String requestTime;
  final String requestedFrom;
  final String requestedTo;
  final int returned;
  final String title;
  final String mainPoint;
  final String source;
  final String url;
  final String publishedAt;
  final String companies;

  const NewsHistoryEntry({
    required this.id,
    required this.requestTime,
    required this.requestedFrom,
    required this.requestedTo,
    required this.returned,
    required this.title,
    required this.mainPoint,
    required this.source,
    required this.url,
    required this.publishedAt,
    required this.companies,
  });

  factory NewsHistoryEntry.fromJson(Map<String, dynamic> j) => NewsHistoryEntry(
        id: (j['id'] as num?)?.toInt() ?? 0,
        requestTime: j['request_time'] as String? ?? '',
        requestedFrom: j['requested_from'] as String? ?? '',
        requestedTo: j['requested_to'] as String? ?? '',
        returned: (j['returned'] as num?)?.toInt() ?? 0,
        title: j['title'] as String? ?? '',
        mainPoint: j['main_point'] as String? ?? '',
        source: j['source'] as String? ?? '',
        url: j['url'] as String? ?? '',
        publishedAt: j['published_at'] as String? ?? '',
        companies: j['companies'] as String? ?? '',
      );
}

/// A closed trade preserved for performance tracking (Settings -> Trade Performance).
class TradeHistoryRecord {
  final int id;
  final int? tradeId;
  final String kind;
  final String symbol;
  final String instrument;
  final String signal;
  final String entryPrice;
  final String target;
  final String stopLoss;
  final int confidence;
  final String reason;
  final String generatedAt;
  final String closedAt;
  final String highestPrice;
  final String lowestPrice;
  final String finalPrice;
  final String finalStatus; // TARGET_REACHED | STOP_LOSS_REACHED | EXPIRED_AT_MARKET_CLOSE | CANCELLED
  final String result;
  final String timeframe;
  final String risk;

  const TradeHistoryRecord({
    required this.id,
    this.tradeId,
    required this.kind,
    required this.symbol,
    required this.instrument,
    required this.signal,
    required this.entryPrice,
    required this.target,
    required this.stopLoss,
    required this.confidence,
    required this.reason,
    required this.generatedAt,
    required this.closedAt,
    required this.highestPrice,
    required this.lowestPrice,
    required this.finalPrice,
    required this.finalStatus,
    required this.result,
    required this.timeframe,
    required this.risk,
  });

  factory TradeHistoryRecord.fromJson(Map<String, dynamic> j) => TradeHistoryRecord(
        id: (j['id'] as num?)?.toInt() ?? 0,
        tradeId: (j['trade_id'] as num?)?.toInt(),
        kind: j['kind'] as String? ?? 'option',
        symbol: j['symbol'] as String? ?? '',
        instrument: j['instrument'] as String? ?? '',
        signal: j['signal'] as String? ?? 'BUY',
        entryPrice: j['entry_price'] as String? ?? '',
        target: j['target'] as String? ?? '',
        stopLoss: j['stop_loss'] as String? ?? '',
        confidence: (j['confidence'] as num?)?.toInt() ?? 0,
        reason: j['reason'] as String? ?? '',
        generatedAt: j['generated_at'] as String? ?? '',
        closedAt: j['closed_at'] as String? ?? '',
        highestPrice: j['highest_price'] as String? ?? '',
        lowestPrice: j['lowest_price'] as String? ?? '',
        finalPrice: j['final_price'] as String? ?? '',
        finalStatus: j['final_status'] as String? ?? 'EXPIRED_AT_MARKET_CLOSE',
        result: j['result'] as String? ?? '',
        timeframe: j['timeframe'] as String? ?? '',
        risk: j['risk'] as String? ?? '',
      );
}

/// 24-hour AI trade performance summary.
class TradePerformance {
  final int windowHours;
  final int total;
  final int successful;
  final int loss;
  final int expired;
  final int cancelled;
  final int successRate;
  final int lossRate;
  final int activeCount;

  const TradePerformance({
    required this.windowHours,
    required this.total,
    required this.successful,
    required this.loss,
    required this.expired,
    required this.cancelled,
    required this.successRate,
    required this.lossRate,
    required this.activeCount,
  });

  factory TradePerformance.fromJson(Map<String, dynamic> j) => TradePerformance(
        windowHours: (j['windowHours'] as num?)?.toInt() ?? 24,
        total: (j['total'] as num?)?.toInt() ?? 0,
        successful: (j['successful'] as num?)?.toInt() ?? 0,
        loss: (j['loss'] as num?)?.toInt() ?? 0,
        expired: (j['expired'] as num?)?.toInt() ?? 0,
        cancelled: (j['cancelled'] as num?)?.toInt() ?? 0,
        successRate: (j['successRate'] as num?)?.toInt() ?? 0,
        lossRate: (j['lossRate'] as num?)?.toInt() ?? 0,
        activeCount: (j['activeCount'] as num?)?.toInt() ?? 0,
      );
}
