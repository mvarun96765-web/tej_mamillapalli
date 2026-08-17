import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../services/api_services.dart';
import '../../providers/providers.dart';
import '../auth/auth_screen.dart';
import '../dashboard/dashboard_screen.dart';

/// App-open security gate: PIN / biometric, then Dashboard.
class PinUnlockScreen extends StatefulWidget {
  const PinUnlockScreen({super.key});

  @override
  State<PinUnlockScreen> createState() => _PinUnlockScreenState();
}

class _PinUnlockScreenState extends State<PinUnlockScreen> {
  final LocalAuthentication _auth = LocalAuthentication();
  String pin = '';
  String error = '';
  bool busy = false;
  bool triedBiometric = false;

  @override
  void initState() {
    super.initState();
    _tryBiometric();
  }

  Future<void> _tryBiometric() async {
    final session = context.read<SessionProvider>();
    if (triedBiometric || session.user?.biometricEnabled != true) return;
    triedBiometric = true;
    try {
      final ok = await _auth.authenticate(
        localizedReason: 'Unlock VARUN TEJ',
        options: const AuthenticationOptions(biometricOnly: true, stickyAuth: true),
      );
      if (ok && mounted) _enterApp();
    } catch (_) {}
  }

  Future<void> _enter(String d) async {
    if (busy || pin.length >= 4) return;
    final next = pin + d;
    setState(() => pin = next);
    if (next.length == 4) await _verify(next);
  }

  void _backspace() {
    if (pin.isEmpty) return;
    setState(() => pin = pin.substring(0, pin.length - 1));
  }

  Future<void> _verify(String value) async {
    setState(() => busy = true);
    final session = context.read<SessionProvider>();
    try {
      final ok = await ProfileApi.verifyPin(value);
      if (ok) {
        await session.setUnlocked(true);
        if (mounted) _enterApp();
      } else {
        setState(() {
          error = 'Incorrect PIN';
          pin = '';
          busy = false;
        });
      }
    } on ApiException catch (e) {
      setState(() {
        error = e.message;
        pin = '';
        busy = false;
      });
    }
  }

  void _enterApp() {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const DashboardScreen()),
      (route) => false,
    );
  }

  Future<void> _logout() async {
    final session = context.read<SessionProvider>();
    await session.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const AuthScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        actions: [
          TextButton(onPressed: _logout, child: const Text('Switch account')),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              Icon(Icons.fingerprint, size: 72, color: theme.colorScheme.primary),
              const SizedBox(height: 16),
              const Text('Enter your security PIN', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              if (error.isNotEmpty)
                Text(error, style: const TextStyle(color: AppColors.loss, fontWeight: FontWeight.w700)),
              const SizedBox(height: 24),
              _Dots(filled: pin.length),
              const Spacer(),
              _Pad(onDigit: _enter, onBackspace: _backspace),
              if (busy) const Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()),
            ],
          ),
        ),
      ),
    );
  }
}

class _Dots extends StatelessWidget {
  final int filled;
  const _Dots({required this.filled});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(4, (i) {
        final on = i < filled;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          width: 16,
          height: 16,
          margin: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: on ? Theme.of(context).colorScheme.primary : Colors.transparent,
            border: Border.all(color: on ? Theme.of(context).colorScheme.primary : Colors.grey.shade400, width: 2),
          ),
        );
      }),
    );
  }
}

class _Pad extends StatelessWidget {
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  const _Pad({required this.onDigit, required this.onBackspace});

  @override
  Widget build(BuildContext context) {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      children: digits.map((d) {
        return InkWell(
          borderRadius: BorderRadius.circular(40),
          onTap: () {
            if (d == 'back') {
              onBackspace();
            } else if (d.isNotEmpty) {
              onDigit(d);
            }
          },
          child: d == 'back'
              ? const Icon(Icons.backspace_outlined, size: 26)
              : Center(
                  child: Text(d, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700)),
                ),
        );
      }).toList(),
    );
  }
}
