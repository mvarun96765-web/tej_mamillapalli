import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config.dart';
import '../../providers/providers.dart';
import '../auth/auth_screen.dart';
import '../dashboard/dashboard_screen.dart';
import '../security/pin_unlock_screen.dart';

/// Opening experience: "Welcome MAMILLAPALLI VARUN TEJ", then route by state.
///  - valid session + unlocked            -> Dashboard
///  - valid session + security PIN set    -> PIN unlock
///  - no valid session                    -> Authentication screen
class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});

  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  int _routeAttempts = 0;

  @override
  void initState() {
    super.initState();
    final session = context.read<SessionProvider>();
    final theme = context.read<ThemeProvider>();
    // bootstrap() reads only local storage (no network) and re-validates the
    // session in the background — it can never stall the splash.
    unawaited(Future.wait([session.bootstrap(), theme.init()]));
    // Fixed 2-second splash, then route automatically.
    Timer(const Duration(seconds: 2), _route);
  }

  void _route() {
    if (!mounted) return;
    final session = context.read<SessionProvider>();
    if (session.state == SessionState.starting && _routeAttempts < 5) {
      // Storage hiccup: give bootstrap a short grace period (max ~2s more).
      _routeAttempts += 1;
      Timer(const Duration(milliseconds: 400), _route);
      return;
    }
    final loggedIn = session.state == SessionState.authenticated && session.user != null;
    if (loggedIn) {
      final needsPin = session.user!.securityPinSet == true;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => needsPin ? const PinUnlockScreen() : const DashboardScreen(),
      ));
    } else {
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const AuthScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              theme.colorScheme.primary,
              theme.colorScheme.primary.withValues(alpha: 0.75),
            ],
          ),
        ),
        child: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(28),
                ),
                child: const Icon(Icons.trending_up_rounded, size: 56, color: Colors.white),
              ),
              const SizedBox(height: 28),
              const Text(
                'Welcome',
                style: TextStyle(color: Colors.white70, fontSize: 18, letterSpacing: 2),
              ),
              const SizedBox(height: 8),
              const Text(
                AppConfig.welcomeName,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 40),
              const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
