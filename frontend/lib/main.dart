import 'package:flutter/material.dart';
import 'pages/landing_page.dart';

void main() {
  runApp(const EffApp());
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
