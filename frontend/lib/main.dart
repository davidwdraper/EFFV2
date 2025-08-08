import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'pages/landing_page.dart';
import 'pages/acts_page.dart';
import 'providers/auth_provider.dart';
import 'pages/act_form_page.dart' show ActFormPage, ActFormArgs;

// Use: flutter run --dart-define=EFF_API_BASE=http://localhost:4000
const String kApiBase = String.fromEnvironment(
  'EFF_API_BASE',
  defaultValue: 'http://localhost:4000',
);

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => AuthProvider()..checkToken(),
      child: const EffApp(),
    ),
  );
}

class EffApp extends StatelessWidget {
  const EffApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EFF',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        useMaterial3: true,
      ),
      initialRoute: '/',
      routes: {
        '/': (context) => const LandingPage(),
        // ✅ Pass apiBase into ActsPage
        '/acts': (context) => ActsPage(apiBase: kApiBase),

        // ✅ New: preferred route
        '/acts/new': (context) {
          final args =
              ModalRoute.of(context)?.settings.arguments as ActFormArgs?;
          return ActFormPage(args: args);
        },

        // ✅ Back-compat: old route still works
        '/act/create': (context) {
          final args =
              ModalRoute.of(context)?.settings.arguments as ActFormArgs?;
          return ActFormPage(args: args);
        },
      },
    );
  }
}
