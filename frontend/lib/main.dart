import 'package:flutter/material.dart';

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

class LandingPage extends StatelessWidget {
  const LandingPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[100],
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 4.0),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Logo on the far left
              Image.asset(
                'assets/logo.png',
                height: 64,
                fit: BoxFit.contain,
              ),
              const Spacer(),

              // Hamburger menu on the far right
              PopupMenuButton<String>(
                icon: const Icon(Icons.menu, size: 32),
                onSelected: (value) {
                  // You can add navigation logic here later
                  debugPrint('Selected: $value');
                },
                itemBuilder: (BuildContext context) => [
                  const PopupMenuItem(value: 'login', child: Text('Login')),
                  const PopupMenuItem(value: 'create', child: Text('Create Account')),
                  const PopupMenuItem(value: 'acts', child: Text('Acts')),
                  const PopupMenuItem(value: 'profile', child: Text('Profile')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
