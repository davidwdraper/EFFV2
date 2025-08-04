import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../utils/auth_storage.dart';

class AuthProvider extends ChangeNotifier {
  String? _token;
  String? _userId;
  String? _userDisplayName;

  String? get token => _token;
  String? get userId => _userId;
  String? get userDisplayName => _userDisplayName;
  bool get isAuthenticated => _token != null;

  AuthProvider() {
    _init();
  }

  Future<void> _init() async {
    final storedToken = await AuthStorage.getToken();
    if (storedToken != null) {
      _token = storedToken;
      _userId = _extractUserIdFromToken(storedToken);
      if (_userId != null) {
        await _fetchUserDisplayName();
      }
      notifyListeners();
    }
  }

  Future<void> checkToken() async {
    final storedToken = await AuthStorage.getToken();
    if (storedToken != null) {
      _token = storedToken;
      _userId = _extractUserIdFromToken(storedToken);
      if (_userId != null) {
        await _fetchUserDisplayName();
      }
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
      _userId = _extractUserIdFromToken(_token!);
      await AuthStorage.saveToken(_token!);
      await _fetchUserDisplayName();
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
      _userId = _extractUserIdFromToken(_token!);
      await AuthStorage.saveToken(_token!);
      await _fetchUserDisplayName();
      notifyListeners();
    } else {
      throw Exception(jsonDecode(response.body)['message'] ?? 'Signup failed');
    }
  }

  Future<void> logout() async {
    _token = null;
    _userId = null;
    _userDisplayName = null;
    await AuthStorage.clearToken();
    notifyListeners();
  }

  String? _extractUserIdFromToken(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return null;
      final payload = utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
      final data = jsonDecode(payload);
      return data['_id'];
    } catch (e) {
      debugPrint("Token decode error: $e");
      return null;
    }
  }

  Future<void> _fetchUserDisplayName() async {
    if (_userId == null || _token == null) return;

    try {
      final response = await http.get(
        Uri.parse("http://localhost:4000/users/$_userId"),
        headers: {
          'Authorization': 'Bearer $_token',
          'Content-Type': 'application/json',
        },
      );
      if (response.statusCode == 200) {
        final user = jsonDecode(response.body);
        _userDisplayName = "${user['firstname']} ${user['lastname']}";
      } else {
        _userDisplayName = null;
        debugPrint("Failed to fetch user details");
      }
    } catch (e) {
      debugPrint("Error fetching user info: $e");
    }
  }
}
