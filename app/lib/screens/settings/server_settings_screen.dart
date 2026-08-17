import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config.dart';
import '../../providers/providers.dart';
import '../../services/api_client.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';

/// Runtime backend URL override — no hardcoded server in the app.
class ServerSettingsScreen extends StatefulWidget {
  const ServerSettingsScreen({super.key});

  @override
  State<ServerSettingsScreen> createState() => _ServerSettingsScreenState();
}

class _ServerSettingsScreenState extends State<ServerSettingsScreen> {
  final controller = TextEditingController(text: ApiClient.baseUrl);
  bool saving = false;

  Future<void> _save() async {
    final url = controller.text.trim();
    setState(() => saving = true);
    try {
      await ApiClient.setServerUrl(url);
      await ProfileApi.saveSettings(serverUrl: ApiClient.baseUrl);
      final session = context.read<SessionProvider>();
      await session.resolveSession();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Server URL updated')));
      }
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not reach server: ${e.message}')));
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('SERVER')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          FormCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('VARUN TEJ API URL', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Colors.grey)),
                const SizedBox(height: 6),
                TextField(
                  controller: controller,
                  keyboardType: TextInputType.url,
                  decoration: const InputDecoration(
                    labelText: 'Backend URL',
                    hintText: 'https://your-backend.example.com',
                    prefixIcon: Icon(Icons.dns),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  'Build-time default: ${AppConfig.defaultBaseUrl}\nSet this to your deployed backend so the phone works without your laptop.',
                  style: const TextStyle(fontSize: 12, color: Colors.grey, height: 1.5),
                ),
                const SizedBox(height: 20),
                PrimaryButton(label: 'SAVE & TEST', loading: saving, onPressed: saving ? null : _save),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
