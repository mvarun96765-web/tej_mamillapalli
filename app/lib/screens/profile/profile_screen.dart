import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../providers/providers.dart';
import '../../services/api_services.dart';
import '../auth/auth_screen.dart';
import '../settings/security_settings_screen.dart';
import '../settings/settings_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionProvider>();
    final user = session.user;
    final theme = Theme.of(context);

    if (user == null) return const SizedBox.shrink();

    return Scaffold(
      appBar: AppBar(title: const Text('PROFILE')),
      body: ListView(
        children: [
          const SizedBox(height: 12),
          // Profile image + edit
          Center(
            child: Column(
              children: [
                Stack(
                  children: [
                    CircleAvatar(
                      radius: 52,
                      backgroundColor: theme.colorScheme.primary.withValues(alpha: 0.15),
                      backgroundImage: user.profilePic.isNotEmpty ? MemoryImage(_safeBytes(user.profilePic)) : null,
                      child: user.profilePic.isEmpty
                          ? Text(
                              user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U',
                              style: TextStyle(fontSize: 40, fontWeight: FontWeight.w900, color: theme.colorScheme.primary),
                            )
                          : null,
                    ),
                    Positioned(
                      right: 0,
                      bottom: 0,
                      child: InkWell(
                        onTap: () => _editPhoto(context),
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary,
                            shape: BoxShape.circle,
                            border: Border.all(color: theme.scaffoldBackgroundColor, width: 2),
                          ),
                          child: const Icon(Icons.camera_alt, size: 16, color: Colors.white),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TextButton(onPressed: () => _editPhoto(context), child: const Text('Edit Photo')),
                const SizedBox(height: 6),
                Text(user.name, textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                const SizedBox(height: 2),
                Text('@${user.username}', style: TextStyle(fontSize: 14, color: Colors.grey.shade600)),
              ],
            ),
          ),
          const SizedBox(height: 20),
          // Name edit
          Card(
            child: ListTile(
              leading: const Icon(Icons.badge_outlined),
              title: const Text('Name'),
              subtitle: Text(user.name, style: const TextStyle(fontSize: 13)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _editName(context),
            ),
          ),
          // Username edit
          Card(
            child: ListTile(
              leading: const Icon(Icons.alternate_email),
              title: const Text('Username'),
              subtitle: Text('@${user.username}', style: const TextStyle(fontSize: 13)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _editUsername(context),
            ),
          ),
          // Security
          Card(
            child: ListTile(
              leading: const Icon(Icons.security, color: AppColors.primary),
              title: const Text('Security'),
              subtitle: Text(user.securityPinSet ? 'PIN set · biometric ${user.biometricEnabled ? 'on' : 'off'}' : 'Set up security PIN & biometrics', style: const TextStyle(fontSize: 12)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SecuritySettingsScreen())),
            ),
          ),
          // Settings
          Card(
            child: ListTile(
              leading: const Icon(Icons.settings_outlined),
              title: const Text('Settings'),
              subtitle: const Text('Notifications · AI API Keys · Appearance · Account', style: TextStyle(fontSize: 12)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen())),
            ),
          ),
          const SizedBox(height: 16),
          // Logout
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SizedBox(
              height: 50,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.loss,
                  side: BorderSide(color: AppColors.loss.withValues(alpha: 0.6)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                onPressed: () => _confirmLogout(context),
                icon: const Icon(Icons.logout),
                label: const Text('Logout', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Uint8List _safeBytes(String data) {
    try {
      return base64Decode(data);
    } catch (_) {
      return Uint8List(0);
    }
  }

  Future<void> _editPhoto(BuildContext context) async {
    final session = context.read<SessionProvider>();
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera), title: const Text('Camera'), onTap: () => Navigator.pop(c, 'camera')),
            ListTile(leading: const Icon(Icons.photo_library), title: const Text('Gallery'), onTap: () => Navigator.pop(c, 'gallery')),
            ListTile(leading: const Icon(Icons.delete_outline), title: const Text('Remove Photo'), onTap: () => Navigator.pop(c, 'remove')),
          ],
        ),
      ),
    );
    if (action == null) return;

    try {
      if (action == 'remove') {
        await ProfileApi.removePicture();
      } else {
        final picker = ImagePicker();
        final file = action == 'camera'
            ? await picker.pickImage(source: ImageSource.camera, imageQuality: 70, maxWidth: 800)
            : await picker.pickImage(source: ImageSource.gallery, imageQuality: 70, maxWidth: 800);
        if (file == null) return;
        final bytes = await file.readAsBytes();
        await ProfileApi.updatePicture(base64Encode(bytes));
      }
      await session.refreshUser();
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Photo update failed: $e')));
      }
    }
  }

  Future<void> _editName(BuildContext context) async {
    final session = context.read<SessionProvider>();
    final controller = TextEditingController(text: session.user?.name ?? '');
    final result = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Edit Name'),
        content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(labelText: 'Name')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              if (controller.text.trim().isNotEmpty) Navigator.pop(c, controller.text.trim());
            },
            child: const Text('SAVE'),
          ),
        ],
      ),
    );
    if (result == null) return;
    try {
      await ProfileApi.updateName(result);
      await session.refreshUser();
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _editUsername(BuildContext context) async {
    final session = context.read<SessionProvider>();
    final controller = TextEditingController(text: session.user?.username ?? '');
    String? feedback;

    final result = await showDialog<String>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setState) => AlertDialog(
          title: const Text('Edit Username'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(controller: controller, autofocus: true, decoration: const InputDecoration(labelText: 'New Username')),
              if (feedback != null) ...[
                const SizedBox(height: 8),
                Text(feedback ?? '', style: TextStyle(color: feedback!.contains('available') || feedback!.contains('updated') ? AppColors.gain : AppColors.loss, fontSize: 12)),
              ],
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () async {
                final name = controller.text.trim();
                if (name.isEmpty) return;
                final available = await ProfileApi.usernameAvailable(name);
                setState(() => feedback = available ? 'Username available' : 'Username already exists');
                if (available) Navigator.pop(c, name);
              },
              child: const Text('SAVE'),
            ),
          ],
        ),
      ),
    );
    if (result == null) return;
    try {
      await ProfileApi.updateUsername(result);
      await session.refreshUser();
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Logout?'),
        content: const Text('You will need to log in again to access the app.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.loss),
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final session = context.read<SessionProvider>();
    await session.logout();
    if (!context.mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const AuthScreen()),
      (route) => false,
    );
  }
}
