import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../utils/auth_storage.dart';

class AuthProvider extends ChangeNotifier {
  String? _token;
  String? _userId;
  String? _userDisplayName;
  Map<String, dynamic>? _user;

  // ---- Public getters ----
  String? get token => _token;
  String? get jwt => _token; // alias, for pages expecting `jwt`
  String? get userId => _userId;
  String? get userDisplayName => _userDisplayName;
  Map<String, dynamic>? get user => _user;
  bool get isAuthenticated => _token != null && _token!.isNotEmpty;

  AuthProvider() {
    _init();
  }

  Future<void> _init() async {
    final storedToken = await AuthStorage.getToken();
    if (storedToken != null && storedToken.isNotEmpty) {
      _token = storedToken;
      _decodeAndSetUserFromToken(storedToken);
      notifyListeners();
    }
  }

  Future<void> checkToken() async {
    final storedToken = await AuthStorage.getToken();
    if (storedToken != null && storedToken.isNotEmpty) {
      _token = storedToken;
      _decodeAndSetUserFromToken(storedToken);
      notifyListeners();
    } else {
      await logout();
    }
  }

  // ---- Auth API calls ----
  // Tip: consider moving the base URL to a config file/env
  static const String _apiBase = 'http://localhost:4000';

  Future<void> loginWithCredentials(String email, String password) async {
    final resp = await http.post(
      Uri.parse('$_apiBase/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'eMailAddr': email, 'password': password}),
    );

    if (resp.statusCode == 200) {
      final data = jsonDecode(resp.body) as Map<String, dynamic>;
      final token = (data['token'] ?? '') as String;
      if (token.isEmpty) throw Exception('No token returned from login');

      _token = token;
      await AuthStorage.saveToken(token);
      _decodeAndSetUserFromToken(token);
      notifyListeners();
    } else {
      final body = _safeJson(resp.body);
      throw Exception(body['message'] ?? 'Login failed (${resp.statusCode})');
    }
  }

  Future<void> signupWithCredentials(Map<String, String> userDetails) async {
    final resp = await http.post(
      Uri.parse('$_apiBase/auth/signup'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(userDetails),
    );

    if (resp.statusCode == 201) {
      final data = jsonDecode(resp.body) as Map<String, dynamic>;
      final token = (data['token'] ?? '') as String;
      if (token.isEmpty) throw Exception('No token returned from signup');

      _token = token;
      await AuthStorage.saveToken(token);
      _decodeAndSetUserFromToken(token);
      notifyListeners();
    } else {
      final body = _safeJson(resp.body);
      throw Exception(body['message'] ?? 'Signup failed (${resp.statusCode})');
    }
  }

  Future<void> logout() async {
    _token = null;
    _userId = null;
    _userDisplayName = null;
    _user = null;
    await AuthStorage.clearToken();
    notifyListeners();
  }

  // ---- Helpers ----
  void _decodeAndSetUserFromToken(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return;

      final payload =
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
      final data = jsonDecode(payload) as Map<String, dynamic>;

      _user = data;
      _userId = (data['_id'] ?? data['id'])?.toString();

      final firstname = (data['firstname'] ?? '').toString();
      final middlename = (data['middlename'] ?? '').toString();
      final lastname = (data['lastname'] ?? '').toString();
      _userDisplayName = ('$firstname $middlename $lastname')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
    } catch (e) {
      debugPrint('Token decode error: $e');
    }
  }

  Map<String, dynamic> _safeJson(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
