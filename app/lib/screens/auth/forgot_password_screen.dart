import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';
import 'login_screen.dart';

/// Forgot password — verified with the account's date of birth (no OTP):
///   Step 0: username/email + date of birth  →  Step 1: new password  →  Step 2: success
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  int step = 0; // 0 verify identity, 1 new password, 2 success
  bool loading = false;
  String? error;
  String resetToken = '';

  final identifier = TextEditingController();
  final password = TextEditingController();
  final confirm = TextEditingController();
  final dobController = TextEditingController();
  DateTime? dob;

  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  @override
  void dispose() {
    identifier.dispose();
    password.dispose();
    confirm.dispose();
    dobController.dispose();
    super.dispose();
  }

  String get _dobText => dob == null
      ? ''
      : '${dob!.year.toString().padLeft(4, '0')}-${dob!.month.toString().padLeft(2, '0')}-${dob!.day.toString().padLeft(2, '0')}';

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: dob ?? DateTime(now.year - 18, now.month, now.day),
      firstDate: DateTime(1900),
      lastDate: now,
      helpText: 'SELECT DATE OF BIRTH',
    );
    if (picked != null) {
      setState(() {
        dob = picked;
        dobController.text = _dobText;
      });
    }
  }

  Future<void> _next() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      if (step == 0) {
        if (identifier.text.trim().isEmpty) throw ApiException('Enter your username or email');
        if (dob == null) throw ApiException('Select your date of birth');
        resetToken = await AuthApi.forgotVerify(identifier.text.trim(), _dobText);
        if (resetToken.isEmpty) throw ApiException('Verification failed. Please try again.');
        setState(() => step = 1);
      } else if (step == 1) {
        if (password.text.length < 8) throw ApiException('Password must be at least 8 characters');
        if (password.text != confirm.text) throw ApiException('Passwords do not match');
        await AuthApi.forgotReset(resetToken, password.text);
        setState(() => step = 2);
      }
    } catch (e) {
      setState(() => error = e is ApiException ? e.message : 'Something went wrong');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (step == 2) {
      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.lock_reset, size: 88, color: AppColors.gain),
                const SizedBox(height: 24),
                const Text('PASSWORD UPDATED SUCCESSFULLY', textAlign: TextAlign.center, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                const SizedBox(height: 40),
                PrimaryButton(
                  label: 'LOGIN',
                  onPressed: () => Navigator.of(context).pushAndRemoveUntil(
                    MaterialPageRoute(builder: (_) => const LoginScreen()),
                    (route) => false,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () {
          if (step == 0) Navigator.of(context).pop();
          setState(() => step -= 1);
        }),
        title: const Text('FORGOT PASSWORD'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: FormCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  step == 0 ? 'Verify Your Identity' : 'Create New Password',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                Text(
                  step == 0
                      ? 'Enter your username or email and your date of birth. Password reset is allowed only when the date of birth matches your account.'
                      : 'Choose a strong new password.',
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
                ),
                const SizedBox(height: 24),
                ErrorBanner(message: error),
                if (step == 0) ...[
                  TextField(
                    controller: identifier,
                    textCapitalization: TextCapitalization.none,
                    decoration: const InputDecoration(labelText: 'Username / Email', prefixIcon: Icon(Icons.alternate_email)),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    readOnly: true,
                    onTap: _pickDob,
                    controller: dobController,
                    decoration: const InputDecoration(
                      labelText: 'Date of Birth',
                      hintText: 'Select your date of birth',
                      prefixIcon: Icon(Icons.cake_outlined),
                      suffixIcon: Icon(Icons.calendar_today, size: 18),
                    ),
                  ),
                ] else ...[
                  TextField(
                    controller: password,
                    obscureText: _obscurePassword,
                    decoration: InputDecoration(
                      labelText: 'New Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: confirm,
                    obscureText: _obscureConfirm,
                    onSubmitted: (_) => _next(),
                    decoration: InputDecoration(
                      labelText: 'Confirm Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(_obscureConfirm ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                PrimaryButton(
                  label: step == 1 ? 'Update Password' : 'Continue',
                  loading: loading,
                  onPressed: loading ? null : _next,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
