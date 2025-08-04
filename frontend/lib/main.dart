import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'pages/landing_page.dart';
import 'providers/auth_provider.dart'; // 👈 You'll create this next

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
      home: const LandingPage(),
    );
  }
}
