import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'providers/auth_provider.dart';
import 'pages/landing_page.dart';
import 'pages/acts_page.dart';
import 'pages/act_form_page.dart';

void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => AuthProvider(), // loads token on init
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  static const String kApiBase = 'http://localhost:4000';

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Easy Fun Finder',
      debugShowCheckedModeBanner: false,
      home: const LandingPage(), // ✅ Start here
      onGenerateRoute: (settings) {
        switch (settings.name) {
          case '/acts':
            return MaterialPageRoute(
              builder: (_) => ActsPage(apiBase: kApiBase),
              settings: settings,
            );

          case '/actForm':
          case '/acts/new':
            {
              String? actId;
              String? jwt;
              String? prefillName;
              String? prefillHomeTown;

              final args = settings.arguments;
              if (args is Map<String, dynamic>) {
                actId = args['actId'] as String?;
                jwt = args['jwt'] as String?;
                prefillName = args['prefillName'] as String?;
                prefillHomeTown = args['prefillHomeTown'] as String?;
              }

              return MaterialPageRoute(
                builder: (_) => ActFormPage(
                  actId: actId,
                  jwt: jwt,
                  prefillName: prefillName, // ✅ pass through
                  prefillHomeTown: prefillHomeTown, // ✅ pass through
                ),
                settings: settings,
              );
            }

          default:
            return MaterialPageRoute(
              builder: (_) => Scaffold(
                appBar: AppBar(title: const Text('Not found')),
                body: Center(
                  child: Text('No route defined for ${settings.name}'),
                ),
              ),
              settings: settings,
            );
        }
      },
    );
  }
}
