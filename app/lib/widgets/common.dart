import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../core/theme.dart';
import '../models/models.dart';

/// Section title used across the dashboard, e.g. "TOP STOCK GAINERS".
class SectionHeader extends StatelessWidget {
  final String title;
  final Widget? trailing;
  final EdgeInsets padding;

  const SectionHeader(this.title, {super.key, this.trailing, this.padding = const EdgeInsets.fromLTRB(20, 14, 20, 6)});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 0.4),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Change pill: "+2.37%" green / "-0.12%" red.
class ChangePill extends StatelessWidget {
  final double value;
  final String? text;

  const ChangePill(this.value, {super.key, this.text});

  @override
  Widget build(BuildContext context) {
    final color = AppTheme.changeColor(value);
    final label = text ?? '${value >= 0 ? '+' : ''}${value.toStringAsFixed(2)}%';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

/// Big live index card (NIFTY / BANKNIFTY / SENSEX).
class IndexCard extends StatelessWidget {
  final String name;
  final Quote quote;
  final bool live;

  const IndexCard({super.key, required this.name, required this.quote, this.live = true});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = AppTheme.changeColor(quote.percentChange);

    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              theme.colorScheme.primary.withValues(alpha: 0.10),
              theme.cardTheme.color ?? theme.cardColor,
            ],
          ),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: theme.colorScheme.primary.withValues(alpha: 0.25)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                const Spacer(),
                if (live)
                  Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(color: AppColors.gain, shape: BoxShape.circle),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              quote.error != null ? '—' : _fmt(quote.ltp),
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                ChangePill(quote.percentChange),
                const SizedBox(width: 8),
                Text(
                  quote.error != null ? 'unavailable' : '${quote.netchange >= 0 ? '+' : ''}${quote.netchange.toStringAsFixed(2)}',
                  style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _fmt(double v) => NumberFormat('#,##,##0.00').format(v);
}

/// Gainers list row (stocks & options share the visual language).
class GainerTile extends StatelessWidget {
  final Gainer gainer;
  final VoidCallback? onTap;

  const GainerTile({super.key, required this.gainer, this.onTap});

  @override
  Widget build(BuildContext context) {
    final sub = gainer.optionType != null
        ? '${gainer.optionType} · ${gainer.strike ?? ''}'
        : 'NSE';
    return ListTile(
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20),
      leading: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(
          gainer.optionType != null ? Icons.show_chart : Icons.business,
          size: 18,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
      title: Text(gainer.symbol, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
      subtitle: Text(sub, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(NumberFormat('#,##,##0.00').format(gainer.ltp), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          ChangePill(gainer.percentChange),
        ],
      ),
      onTap: onTap,
    );
  }
}

/// Full-width primary button with loading state.
class PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool loading;

  const PrimaryButton({super.key, required this.label, required this.onPressed, this.loading = false});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton(
        onPressed: loading ? null : onPressed,
        child: loading
            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
            : Text(label),
      ),
    );
  }
}

/// Card wrapper for forms.
class FormCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;

  const FormCard({super.key, required this.child, this.padding = const EdgeInsets.all(20)});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(padding: padding, child: child),
    );
  }
}

/// Error banner used by auth flows.
class ErrorBanner extends StatelessWidget {
  final String? message;

  const ErrorBanner({super.key, this.message});

  @override
  Widget build(BuildContext context) {
    if (message == null || message!.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.loss.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.loss.withValues(alpha: 0.4)),
      ),
      child: Text(message!, style: const TextStyle(color: AppColors.loss, fontSize: 13, fontWeight: FontWeight.w600)),
    );
  }
}

/// Unread badge (bell icon).
class NotificationBell extends StatelessWidget {
  final int unread;

  const NotificationBell({super.key, required this.unread});

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        const Icon(Icons.notifications_none, size: 26),
        if (unread > 0)
          Positioned(
            right: -6,
            top: -6,
            child: Container(
              padding: const EdgeInsets.all(4),
              constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
              decoration: const BoxDecoration(color: AppColors.loss, shape: BoxShape.circle),
              child: Text(
                '$unread',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800),
              ),
            ),
          ),
      ],
    );
  }
}

/// Format a price with Indian grouping.
String formatPrice(double v) => NumberFormat('#,##,##0.00').format(v);

/// Short "time ago" text.
String timeAgo(String iso) {
  final dt = DateTime.tryParse(iso);
  if (dt == null) return '';
  final diff = DateTime.now().difference(dt.toLocal());
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  return '${diff.inDays}d ago';
}
