import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../services/api_services.dart';
import '../../providers/providers.dart';
import '../../widgets/common.dart';
import '../dashboard/dashboard_screen.dart';

/// Security setup: create PIN -> confirm PIN -> optional biometric.
class PinSetupScreen extends StatefulWidget {
  final bool firstTime;
  const PinSetupScreen({super.key, this.firstTime = false});

  @override
  State<PinSetupScreen> createState() => _PinSetupScreenState();
}

class _PinSetupScreenState extends State<PinSetupScreen> {
  final LocalAuthentication _auth = LocalAuthentication();

  bool confirming = false;
  String? pin;
  String error = '';
  bool saving = false;
  bool enableBiometric = false;
  bool biometricAvailable = false;
  bool done = false;

  @override
  void initState() {
    super.initState();
    _auth.isDeviceSupported().then((v) async {
      if (!mounted) return;
      setState(() => biometricAvailable = v);
    });
  }

  String get _current => confirming ? (pin ?? '') : '';

  void _enter(String d) {
    if (saving || done || _current.length >= 4) return;
    setState(() {});
    if (!confirming && _current.length + 1 == 4) {
      setState(() {
        pin = _current + d;
        confirming = true;
        error = '';
      });
      return;
    }
    if (confirming && _current.length + 1 == 4) {
      final next = _current + d;
      if (next == pin) {
        _save(next);
      } else {
        setState(() {
          error = 'PINs do not match. Try again.';
          confirming = false;
          pin = null;
        });
      }
    }
  }

  void _backspace() {
    if (saving || done || _current.isEmpty) return;
    setState(() {
      if (confirming) {
        pin = (pin ?? '').substring(0, (pin ?? '').length - 1);
      }
    });
  }

  Future<void> _save(String value) async {
    setState(() => saving = true);
    try {
      await ProfileApi.savePin(value);
      if (enableBiometric) await ProfileApi.setBiometric(true);
      await context.read<SessionProvider>().refreshUser();
      setState(() => done = true);
    } on ApiException catch (e) {
      setState(() => error = e.message);
    } finally {
      setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('SECURITY'),
        automaticallyImplyLeading: !widget.firstTime,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: done
              ? Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.shield_rounded, size: 96, color: AppColors.gain),
                    const SizedBox(height: 20),
                    const Text('SECURITY SETUP COMPLETE', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 8),
                    Text('Your app is now protected with a security PIN${enableBiometric ? ' and biometrics' : ''}.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade600)),
                    const SizedBox(height: 40),
                    PrimaryButton(
                      label: 'Open Dashboard',
                      onPressed: () async {
                        final session = context.read<SessionProvider>();
                        await session.setUnlocked(true);
                        if (!mounted) return;
                        Navigator.of(context).pushAndRemoveUntil(
                          MaterialPageRoute(builder: (_) => const DashboardScreen()),
                          (route) => false,
                        );
                      },
                    ),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 20),
                    Icon(Icons.lock_outline, size: 56, color: Theme.of(context).colorScheme.primary),
                    const SizedBox(height: 12),
                    Text(
                      confirming ? 'Confirm Security PIN' : 'Create Security PIN',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 6),
                    Text('4-digit PIN · stored encrypted, never as plain text', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                    const SizedBox(height: 24),
                    ErrorBanner(message: error.isEmpty ? null : error),
                    _Dots(filled: _current.length),
                    const SizedBox(height: 20),
                    if (biometricAvailable && !confirming) ...[
                      SwitchListTile(
                        title: const Text('Enable Fingerprint / Biometric'),
                        value: enableBiometric,
                        onChanged: (v) => setState(() => enableBiometric = v),
                      ),
                      const SizedBox(height: 8),
                    ],
                    const SizedBox(height: 12),
                    _Pad(onDigit: _enter, onBackspace: _backspace),
                    const SizedBox(height: 12),
                    if (saving) const Center(child: CircularProgressIndicator()),
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
        return Container(
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
