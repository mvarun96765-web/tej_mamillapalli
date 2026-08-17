import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/providers.dart';

class AppearanceSettingsScreen extends StatelessWidget {
  const AppearanceSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('APPEARANCE')),
      body: RadioGroup<ThemeMode>(
        groupValue: theme.mode,
        onChanged: (v) => theme.setMode(v ?? ThemeMode.system),
        child: ListView(
          children: const [
            RadioListTile<ThemeMode>(
              title: Text('Light'),
              value: ThemeMode.light,
            ),
            RadioListTile<ThemeMode>(
              title: Text('Dark'),
              value: ThemeMode.dark,
            ),
            RadioListTile<ThemeMode>(
              title: Text('System'),
              value: ThemeMode.system,
            ),
            Padding(
              padding: EdgeInsets.all(20),
              child: Text(
                'The welcome screen keeps its dedicated opening treatment; the rest of the app follows the selected theme.',
                style: TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
