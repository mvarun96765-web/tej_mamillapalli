import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import '../../services/api_services.dart';
import '../../widgets/common.dart';
import 'login_screen.dart';

/// Single-page Sign-Up: Username, Email, Date of Birth, Password, Confirm.
/// No OTP / SMS / email verification — after a successful signup the user is
/// taken straight to the Login page.
class SignupFlowScreen extends StatefulWidget {
  const SignupFlowScreen({super.key});

  @override
  State<SignupFlowScreen> createState() => _SignupFlowScreenState();
}

class _SignupFlowScreenState extends State<SignupFlowScreen> {
  final _formKey = GlobalKey<FormState>();
  bool loading = false;
  bool created = false;
  String? error;

  final username = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();
  final confirmPassword = TextEditingController();
  final dobController = TextEditingController();

  DateTime? dob;
  Timer? _usernameDebounce;
  bool? _usernameAvailable;
  String? _usernameHint;

  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  @override
  void dispose() {
    _usernameDebounce?.cancel();
    username.dispose();
    email.dispose();
    password.dispose();
    confirmPassword.dispose();
    dobController.dispose();
    super.dispose();
  }

  void _onUsernameChanged(String value) {
    _usernameDebounce?.cancel();
    final v = value.trim();
    if (v.isEmpty) {
      setState(() {
        _usernameAvailable = null;
        _usernameHint = null;
      });
      return;
    }
    if (!RegExp(r'^[a-zA-Z0-9_]{3,20}$').hasMatch(v)) {
      setState(() {
        _usernameAvailable = null;
        _usernameHint = '3-20 characters: letters, numbers or underscore only';
      });
      return;
    }
    _usernameDebounce = Timer(const Duration(milliseconds: 450), () async {
      try {
        final ok = await AuthApi.checkUsername(v);
        if (!mounted || username.text.trim() != v) return;
        setState(() {
          _usernameAvailable = ok;
          _usernameHint = ok ? 'Username available' : 'Username already exists';
        });
      } catch (_) {}
    });
  }

  bool get _strong =>
      password.text.length >= 8 &&
      password.text.contains(RegExp(r'[a-z]')) &&
      password.text.contains(RegExp(r'[A-Z]')) &&
      password.text.contains(RegExp(r'\d')) &&
      password.text.contains(RegExp(r'[^A-Za-z0-9]'));

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

  String get _dobText => dob == null
      ? ''
      : '${dob!.year.toString().padLeft(4, '0')}-${dob!.month.toString().padLeft(2, '0')}-${dob!.day.toString().padLeft(2, '0')}';

  Future<void> _submit() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      if (!_formKey.currentState!.validate()) {
        setState(() => loading = false);
        return;
      }
      if (dob == null) throw ApiException('Select your date of birth');
      if (password.text != confirmPassword.text) throw ApiException('Passwords do not match');
      if (!_strong) throw ApiException('Password does not meet all requirements');

      await AuthApi.signup(
        username: username.text.trim(),
        email: email.text.trim().toLowerCase(),
        dob: _dobText,
        password: password.text,
      );
      if (!mounted) return;
      setState(() => created = true);
    } catch (e) {
      setState(() => error = e is ApiException ? e.message : 'Something went wrong');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _goToLogin() {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (created) {
      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.check_circle_rounded, size: 96, color: AppColors.gain),
                const SizedBox(height: 24),
                const Text(
                  'ACCOUNT CREATED SUCCESSFULLY',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                Text(
                  'Your account is ready. Log in with your username and password.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
                ),
                const SizedBox(height: 40),
                PrimaryButton(label: 'LOGIN', onPressed: _goToLogin),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(leading: const BackButton(), title: const Text('SIGN UP')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: FormCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('CREATE ACCOUNT', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 6),
                  Text(
                    'Enter your details below. No OTP or phone verification needed.',
                    style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
                  ),
                  const SizedBox(height: 24),
                  ErrorBanner(message: error),
                  TextFormField(
                    controller: username,
                    textCapitalization: TextCapitalization.none,
                    onChanged: _onUsernameChanged,
                    decoration: InputDecoration(
                      labelText: 'Username',
                      hintText: 'e.g. varuntej',
                      prefixIcon: const Icon(Icons.alternate_email),
                      suffixIcon: _usernameAvailable == null
                          ? null
                          : Icon(
                              _usernameAvailable! ? Icons.check_circle : Icons.cancel,
                              color: _usernameAvailable! ? AppColors.gain : AppColors.loss,
                            ),
                    ),
                    validator: (v) {
                      final value = (v ?? '').trim();
                      if (value.isEmpty) return 'Enter a username';
                      if (!RegExp(r'^[a-zA-Z0-9_]{3,20}$').hasMatch(value)) {
                        return '3-20 characters: letters, numbers or underscore only';
                      }
                      return null;
                    },
                  ),
                  if (_usernameHint != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6, left: 4),
                      child: Text(
                        _usernameHint!,
                        style: TextStyle(
                          fontSize: 12,
                          color: _usernameAvailable == false ? AppColors.loss : Colors.grey.shade600,
                        ),
                      ),
                    ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email Address', prefixIcon: Icon(Icons.mail_outline)),
                    validator: (v) {
                      final value = (v ?? '').trim();
                      if (value.isEmpty) return 'Enter your email address';
                      if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value)) return 'Enter a valid email address';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    readOnly: true,
                    onTap: _pickDob,
                    controller: dobController,
                    decoration: InputDecoration(
                      labelText: 'Date of Birth',
                      hintText: 'Select your date of birth',
                      prefixIcon: const Icon(Icons.cake_outlined),
                      suffixIcon: const Icon(Icons.calendar_today, size: 18),
                    ),
                    validator: (v) => dob == null ? 'Select your date of birth' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: password,
                    obscureText: _obscurePassword,
                    decoration: InputDecoration(
                      labelText: 'Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                      ),
                    ),
                    validator: (v) {
                      if ((v ?? '').isEmpty) return 'Enter a password';
                      if (!_strong) return 'Password does not meet all requirements';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: confirmPassword,
                    obscureText: _obscureConfirm,
                    onFieldSubmitted: (_) => _submit(),
                    decoration: InputDecoration(
                      labelText: 'Confirm Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(_obscureConfirm ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                      ),
                    ),
                    validator: (v) {
                      if ((v ?? '').isEmpty) return 'Confirm your password';
                      if (v != password.text) return 'Passwords do not match';
                      return null;
                    },
                  ),
                  const SizedBox(height: 20),
                  _RequirementRow(ok: password.text.length >= 8, label: 'Minimum 8 characters'),
                  _RequirementRow(ok: password.text.contains(RegExp(r'[a-z]')) && password.text.contains(RegExp(r'[A-Z]')), label: 'Upper & lower case letters'),
                  _RequirementRow(ok: password.text.contains(RegExp(r'\d')), label: 'At least one number'),
                  _RequirementRow(ok: password.text.contains(RegExp(r'[^A-Za-z0-9]')), label: 'At least one special character'),
                  _RequirementRow(ok: password.text.isNotEmpty && password.text == confirmPassword.text, label: 'Passwords match'),
                  const SizedBox(height: 24),
                  PrimaryButton(label: 'CREATE ACCOUNT', loading: loading, onPressed: loading ? null : _submit),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text("Already have an account?", style: TextStyle(color: Colors.grey.shade600)),
                      TextButton(onPressed: _goToLogin, child: const Text('Login')),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RequirementRow extends StatelessWidget {
  final bool ok;
  final String label;
  const _RequirementRow({required this.ok, required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Icon(ok ? Icons.check_circle : Icons.circle_outlined, size: 18, color: ok ? AppColors.gain : Colors.grey),
          const SizedBox(width: 10),
          Text(label, style: TextStyle(fontSize: 12.5, color: ok ? null : Colors.grey.shade600)),
        ],
      ),
    );
  }
}
