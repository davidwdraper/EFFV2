import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'pages/landing_page.dart';
import 'pages/acts_page.dart'; // ✅ Add this
import 'providers/auth_provider.dart';

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
        '/acts': (context) => const ActsPage(), // ✅ Register Acts route
        // Add others like '/profile', '/login' as needed
      },
    );
  }
}
