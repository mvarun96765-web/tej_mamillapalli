import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';

enum _VerifyState { idle, loading, success, failure }

class AddAiModelScreen extends StatefulWidget {
  const AddAiModelScreen({super.key});

  @override
  State<AddAiModelScreen> createState() => _AddAiModelScreenState();
}

class _AddAiModelScreenState extends State<AddAiModelScreen> {
  String provider = 'google';
  String? model;
  final keyController = TextEditingController();
  bool obscure = true;

  _VerifyState verifyState = _VerifyState.idle;
  String? verifyMessage;
  String? verifyCategory;
  int? latencyMs;
  bool saving = false;
  Map<String, dynamic> providers = {};
  List<String> models = [];

  @override
  void initState() {
    super.initState();
    _loadProviders();
  }

  Future<void> _loadProviders() async {
    try {
      final r = await AiApi.models();
      if (!mounted) return;
      setState(() {
        providers = r['providers'] as Map<String, dynamic>? ?? {};
        models = _modelsFor(provider);
        model = models.isNotEmpty ? models.first : null;
      });
    } catch (_) {}
  }

  List<String> _modelsFor(String p) =>
      ((providers[p] as Map<String, dynamic>?)?['models'] as List? ?? []).cast<String>();

  void _changeProvider(String p) {
    setState(() {
      provider = p;
      models = _modelsFor(p);
      model = models.isNotEmpty ? models.first : null;
      verifyState = _VerifyState.idle;
      verifyMessage = null;
    });
  }

  Future<void> _verify() async {
    final key = keyController.text.trim();
    if (key.isEmpty) {
      setState(() {
        verifyState = _VerifyState.failure;
        verifyMessage = 'API key is required.';
        verifyCategory = 'INVALID_KEY';
      });
      return;
    }
    setState(() {
      verifyState = _VerifyState.loading;
      verifyMessage = null;
    });
    try {
      final r = await AiApi.verifyModel(provider: provider, model: model ?? '', apiKey: key);
      if (!mounted) return;
      if (r['ok'] == true) {
        setState(() {
          verifyState = _VerifyState.success;
          latencyMs = (r['latencyMs'] as num?)?.toInt() ?? 0;
          verifyMessage = 'Model is reachable and ready. Response test: successful';
        });
      } else {
        setState(() {
          verifyState = _VerifyState.failure;
          verifyCategory = r['category'] as String? ?? 'SERVER';
          verifyMessage = r['message'] as String? ?? 'Verification failed';
        });
      }
    } on ApiException catch (e) {
      setState(() {
        verifyState = _VerifyState.failure;
        verifyCategory = 'NETWORK';
        verifyMessage = e.message;
      });
    }
  }

  Future<void> _save() async {
    setState(() => saving = true);
    try {
      await AiApi.saveModel(
        provider: provider,
        model: model ?? '',
        apiKey: keyController.text.trim(),
        latencyMs: latencyMs ?? 0,
      );
      if (!mounted) return;
      Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  void dispose() {
    keyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final canSave = verifyState == _VerifyState.success && !saving;

    return Scaffold(
      appBar: AppBar(title: const Text('ADD AI MODEL')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          FormCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('AI PROVIDER', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Colors.grey)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  initialValue: provider,
                  decoration: const InputDecoration(labelText: 'AI Provider', isDense: true),
                  items: providers.keys
                      .map((p) => DropdownMenuItem(
                            value: p,
                            child: Text((providers[p] as Map<String, dynamic>?)?['label'] as String? ?? p),
                          ))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) _changeProvider(v);
                  },
                ),
                const SizedBox(height: 16),
                const Text('MODEL', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Colors.grey)),
                const SizedBox(height: 6),
                DropdownButtonFormField<String>(
                  initialValue: model,
                  decoration: const InputDecoration(labelText: 'Model', isDense: true),
                  items: models.map((m) => DropdownMenuItem(value: m, child: Text(m))).toList(),
                  onChanged: (v) => setState(() {
                    model = v;
                    verifyState = _VerifyState.idle;
                  }),
                ),
                const SizedBox(height: 16),
                const Text('API KEY', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Colors.grey)),
                const SizedBox(height: 6),
                TextField(
                  controller: keyController,
                  obscureText: obscure,
                  onChanged: (_) => setState(() {
                    verifyState = _VerifyState.idle;
                    verifyMessage = null;
                  }),
                  decoration: InputDecoration(
                    labelText: 'API Key',
                    hintText: 'Enter API key',
                    suffixIcon: IconButton(
                      icon: Icon(obscure ? Icons.visibility_off : Icons.visibility),
                      onPressed: () => setState(() => obscure = !obscure),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                const Text('Security: key is stored encrypted and never shown in full.', style: TextStyle(fontSize: 11, color: Colors.grey)),
                const SizedBox(height: 20),
                // Verify button
                PrimaryButton(
                  label: verifyState == _VerifyState.loading ? 'VERIFYING...' : 'VERIFY API KEY',
                  loading: verifyState == _VerifyState.loading,
                  onPressed: verifyState == _VerifyState.loading ? null : _verify,
                ),
                const SizedBox(height: 16),
                // State card
                if (verifyState == _VerifyState.success)
                  _StateCard(
                    color: AppColors.gain,
                    icon: Icons.check_circle,
                    title: 'API KEY VERIFIED',
                    message: verifyMessage ?? 'Model is reachable and ready.',
                    meta: latencyMs != null ? 'Latency: ${latencyMs}ms' : null,
                  ),
                if (verifyState == _VerifyState.failure)
                  _StateCard(
                    color: AppColors.loss,
                    icon: Icons.error,
                    title: '! VERIFICATION FAILED',
                    message: verifyMessage ?? 'Invalid / expired key or provider rejected the request.',
                    meta: verifyCategory != null ? 'Reason: $verifyCategory' : null,
                  ),
                const SizedBox(height: 20),
                PrimaryButton(
                  label: 'SAVE MODEL',
                  onPressed: canSave ? _save : null,
                ),
                const SizedBox(height: 8),
                if (!canSave && verifyState != _VerifyState.success)
                  const Center(
                    child: Text(
                      'Save is enabled only after a successful verification.',
                      style: TextStyle(fontSize: 11, color: Colors.grey),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Verification states: Idle → Verifying (spinner, duplicate-click protected) → Success (green, Save enabled) / Failure (red, sanitized reason, retry). On timeout or rate limit a clear message is shown.',
            style: TextStyle(fontSize: 11, color: Colors.grey.shade500, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _StateCard extends StatelessWidget {
  final Color color;
  final IconData icon;
  final String title;
  final String? message;
  final String? meta;

  const _StateCard({required this.color, required this.icon, required this.title, this.message, this.meta});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 14)),
                if (message != null) ...[
                  const SizedBox(height: 4),
                  Text(message!, style: const TextStyle(fontSize: 13)),
                ],
                if (meta != null) ...[
                  const SizedBox(height: 2),
                  Text(meta!, style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
