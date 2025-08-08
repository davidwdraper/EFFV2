import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../utils/auth_storage.dart';

class AuthProvider extends ChangeNotifier {
  String? _token;
  String? _userId;
  String? _userDisplayName;
  Map<String, dynamic>? _user;

  // ✅ Public getters
  String? get token => _token;
  String? get jwtToken => _token; // <-- added for pages expecting `jwtToken`
  String? get userId => _userId;
  String? get userDisplayName => _userDisplayName;
  Map<String, dynamic>? get user => _user;
  bool get isAuthenticated => _token != null;

  AuthProvider() {
    _init();
  }

  Future<void> _init() async {
    final storedToken = await AuthStorage.getToken();
    if (storedToken != null) {
      _token = storedToken;
      _decodeAndSetUserFromToken(storedToken);
      notifyListeners();
    }
  }

  Future<void> checkToken() async {
    final storedToken = await AuthStorage.getToken();
    if (storedToken != null) {
      _token = storedToken;
      _decodeAndSetUserFromToken(storedToken);
      notifyListeners();
    } else {
      await logout();
    }
  }

  Future<void> loginWithCredentials(String email, String password) async {
    final response = await http.post(
      Uri.parse('http://localhost:4000/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'eMailAddr': email, 'password': password}),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      _token = data['token'];
      await AuthStorage.saveToken(_token!);
      _decodeAndSetUserFromToken(_token!);
      notifyListeners();
    } else {
      throw Exception(jsonDecode(response.body)['message'] ?? 'Login failed');
    }
  }

  Future<void> signupWithCredentials(Map<String, String> userDetails) async {
    final response = await http.post(
      Uri.parse('http://localhost:4000/auth/signup'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(userDetails),
    );

    if (response.statusCode == 201) {
      final data = jsonDecode(response.body);
      _token = data['token'];
      await AuthStorage.saveToken(_token!);
      _decodeAndSetUserFromToken(_token!);
      notifyListeners();
    } else {
      throw Exception(jsonDecode(response.body)['message'] ?? 'Signup failed');
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

  void _decodeAndSetUserFromToken(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return;

      final payload =
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
      final data = jsonDecode(payload);

      _user = data;
      _userId = data['_id'];
      final firstname = data['firstname'] ?? '';
      final middlename = data['middlename'] ?? '';
      final lastname = data['lastname'] ?? '';
      _userDisplayName = "$firstname $middlename $lastname"
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
    } catch (e) {
      debugPrint("Token decode error: $e");
    }
  }
}
