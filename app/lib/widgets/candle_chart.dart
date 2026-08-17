import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/models.dart';

/// Dependency-free candlestick chart (live graph) rendered with a CustomPainter.
/// Shows candles + volume strip + price labels, and a dashed line at the
/// current live price when [livePrice] is provided.
class CandleChart extends StatelessWidget {
  final List<Candle> candles;
  final double? livePrice;
  final double height;

  const CandleChart({
    super.key,
    required this.candles,
    this.livePrice,
    this.height = 260,
  });

  @override
  Widget build(BuildContext context) {
    if (candles.isEmpty) {
      return SizedBox(
        height: height,
        child: Center(
          child: Text('No candle data available',
              style: TextStyle(color: Colors.grey.shade500, fontSize: 13)),
        ),
      );
    }
    return SizedBox(
      height: height,
      width: double.infinity,
      child: CustomPaint(
        painter: _CandlePainter(
          candles: candles,
          livePrice: livePrice,
          theme: Theme.of(context).brightness,
        ),
      ),
    );
  }
}

class _CandlePainter extends CustomPainter {
  final List<Candle> candles;
  final double? livePrice;
  final Brightness theme;

  _CandlePainter({required this.candles, this.livePrice, required this.theme});

  static const _leftPad = 52.0;
  static const _rightPad = 8.0;
  static const _topPad = 10.0;
  static const _bottomPad = 26.0;

  Color get _gridColor =>
      theme == Brightness.dark ? Colors.white24 : Colors.black12;
  Color get _labelColor =>
      theme == Brightness.dark ? Colors.white54 : Colors.black45;

  @override
  void paint(Canvas canvas, Size size) {
    final chartHeight = size.height - _topPad - _bottomPad;
    final volumeHeight = chartHeight * 0.18;
    final priceHeight = chartHeight - volumeHeight;
    final chartTop = _topPad;
    final chartBottom = chartTop + priceHeight;
    final volumeTop = chartBottom + 4;

    // Price range (pad 5%).
    var minP = double.infinity;
    var maxP = double.negativeInfinity;
    var maxV = 0.0;
    for (final c in candles) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
      if (c.volume > maxV) maxV = c.volume;
    }
    if (livePrice != null) {
      if (livePrice! < minP) minP = livePrice!;
      if (livePrice! > maxP) maxP = livePrice!;
    }
    if (minP == maxP) {
      minP -= 1;
      maxP += 1;
    }
    final pad = (maxP - minP) * 0.05;
    minP -= pad;
    maxP += pad;
    final range = maxP - minP;

    double xFor(int i) =>
        _leftPad + (i / math.max(1, candles.length - 1)) * (size.width - _leftPad - _rightPad);
    double yFor(double price) => chartTop + (1 - (price - minP) / range) * priceHeight;

    // Grid + horizontal price labels.
    for (var i = 0; i <= 4; i++) {
      final y = chartTop + (priceHeight * i) / 4;
      final paint = Paint()
        ..color = _gridColor
        ..strokeWidth = 0.6;
      canvas.drawLine(Offset(_leftPad, y), Offset(size.width - _rightPad, y), paint);
      final price = maxP - (range * i) / 4;
      _label(canvas, _fmt(price), Offset(4, y - 6), _labelColor);
    }

    // Candles.
    final slot = (size.width - _leftPad - _rightPad) / math.max(1, candles.length);
    final bodyW = math.min(10.0, slot * 0.6);
    for (var i = 0; i < candles.length; i++) {
      final c = candles[i];
      final x = xFor(i);
      final up = c.bullish;
      final color = up ? AppColors.gain : AppColors.loss;
      final paint = Paint()
        ..color = color
        ..strokeWidth = 1.2;

      // Wick
      canvas.drawLine(Offset(x, yFor(c.high)), Offset(x, yFor(c.low)), paint);

      // Body
      final openY = yFor(c.open);
      final closeY = yFor(c.close);
      final top = math.min(openY, closeY);
      final bottom = math.max(openY, closeY);
      final bodyH = math.max(bottom - top, 1.0);
      final bodyPaint = Paint()..color = color;
      if (!up) bodyPaint.color = color.withValues(alpha: 1.0);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(x - bodyW / 2, top, bodyW, bodyH),
          const Radius.circular(1.5),
        ),
        bodyPaint,
      );

      // Volume bar
      if (c.volume > 0 && maxV > 0) {
        final vh = (c.volume / maxV) * volumeHeight;
        final vPaint = Paint()..color = color.withValues(alpha: 0.45);
        canvas.drawRect(
          Rect.fromLTWH(x - bodyW / 2, volumeTop + volumeHeight - vh, bodyW, vh),
          vPaint,
        );
      }
    }

    // X-axis date labels (first + last).
    _label(canvas, _shortDate(candles.first.time), Offset(_leftPad, size.height - 18), _labelColor);
    final lastLabel = _shortDate(candles.last.time);
    final tp = TextPainter(
      text: TextSpan(text: lastLabel, style: TextStyle(fontSize: 10, color: _labelColor)),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset(size.width - _rightPad - tp.width, size.height - 18));

    // Live price dashed line.
    if (livePrice != null && livePrice! >= minP && livePrice! <= maxP) {
      final y = yFor(livePrice!);
      final dashPaint = Paint()
        ..color = AppColors.primary
        ..strokeWidth = 1.1;
      final dash = 5.0;
      var dx = _leftPad;
      while (dx < size.width - _rightPad) {
        canvas.drawLine(Offset(dx, y), Offset(math.min(dx + dash, size.width - _rightPad), y), dashPaint);
        dx += dash * 2;
      }
      _label(canvas, 'LIVE ${_fmt(livePrice!)}', Offset(_leftPad + 4, y - 6), AppColors.primary);
    }
  }

  void _label(Canvas canvas, String text, Offset offset, Color color) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w600)),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, offset);
  }

  String _fmt(double v) => v >= 1000 ? v.toStringAsFixed(0) : v.toStringAsFixed(2);

  String _shortDate(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return '';
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${months[d.month]}';
  }

  @override
  bool shouldRepaint(_CandlePainter old) =>
      old.candles != candles || old.livePrice != livePrice || old.theme != theme;
}
