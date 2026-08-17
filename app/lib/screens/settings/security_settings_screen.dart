import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';
import 'package:provider/provider.dart';

import '../../providers/providers.dart';
import '../../services/api_services.dart';
import '../security/pin_setup_screen.dart';

class SecuritySettingsScreen extends StatefulWidget {
  const SecuritySettingsScreen({super.key});

  @override
  State<SecuritySettingsScreen> createState() => _SecuritySettingsScreenState();
}

class _SecuritySettingsScreenState extends State<SecuritySettingsScreen> {
  final LocalAuthentication _auth = LocalAuthentication();
  bool biometricSupported = false;

  @override
  void initState() {
    super.initState();
    _auth.isDeviceSupported().then((v) {
      if (mounted) setState(() => biometricSupported = v);
    });
  }

  Future<void> _setBiometric(bool value) async {
    final session = context.read<SessionProvider>();
    try {
      if (value) {
        await _auth.authenticate(
          localizedReason: 'Enable biometric unlock for VARUN TEJ',
          options: const AuthenticationOptions(biometricOnly: true),
        );
      }
      await ProfileApi.setBiometric(value);
      await session.refreshUser();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(value ? 'Biometric unlock enabled' : 'Biometric unlock disabled')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to update: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionProvider>().user;
    return Scaffold(
      appBar: AppBar(title: const Text('SECURITY')),
      body: ListView(
        children: [
          Card(
            child: ListTile(
              leading: const Icon(Icons.lock_outline),
              title: const Text('Security PIN'),
              subtitle: Text(user?.securityPinSet == true ? 'PIN is set (stored encrypted)' : 'No PIN set yet', style: const TextStyle(fontSize: 12)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PinSetupScreen()),
              ),
            ),
          ),
          if (biometricSupported)
            Card(
              child: SwitchListTile(
                secondary: const Icon(Icons.fingerprint),
                title: const Text('Fingerprint / Biometric'),
                subtitle: const Text('Unlock the app with your device biometrics', style: TextStyle(fontSize: 12)),
                value: user?.biometricEnabled == true,
                onChanged: _setBiometric,
              ),
            ),
          const SizedBox(height: 16),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Text(
              'The security PIN is never stored as plain text. On app open, the dashboard remains locked until the PIN or biometric is verified.',
              style: TextStyle(fontSize: 12, color: Colors.grey, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}
