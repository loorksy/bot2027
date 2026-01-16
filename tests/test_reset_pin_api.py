"""
Test Suite for Reset Client PIN API
Tests the POST /api/admin/clients/:clientKey/reset-pin endpoint
"""

import pytest
import requests
import os

# Base URL for the WhatsApp Bot server
BASE_URL = os.environ.get('BASE_URL', 'http://localhost:3050')

# Test client keys from registered_clients.json
CLIENT_WITH_PHONE = "e5ee4774-548b-45d8-8bda-6bdf59162101"  # فاطمة للاختبار - has phone
CLIENT_WITHOUT_PHONE = "7ca9ff9d-6c56-406b-9481-9f64ac4b5492"  # روان بكار - no phone
NON_EXISTENT_CLIENT = "non-existent-key-12345"


class TestResetPinAPI:
    """Tests for the Reset PIN API endpoint"""
    
    def test_reset_pin_success_with_phone(self):
        """Test: Reset PIN for client with phone number - should succeed with warning (WhatsApp not connected)"""
        response = requests.post(
            f"{BASE_URL}/api/admin/clients/{CLIENT_WITH_PHONE}/reset-pin",
            headers={"Content-Type": "application/json"}
        )
        
        # Status code should be 200
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Should have success flag
        assert data.get("success") == True, "Expected success: true"
        
        # Should have clientName
        assert "clientName" in data, "Response should include clientName"
        
        # Since WhatsApp is not connected, should have warning and newPin
        assert "warning" in data, "Expected warning since WhatsApp is not connected"
        assert "newPin" in data, "Expected newPin in response when WhatsApp fails"
        
        # Verify PIN is 6 digits
        new_pin = data.get("newPin")
        assert new_pin is not None, "newPin should not be None"
        assert len(str(new_pin)) == 6, f"PIN should be 6 digits, got {len(str(new_pin))}"
        assert str(new_pin).isdigit(), "PIN should be numeric"
        
        print(f"✅ Reset PIN success - Client: {data.get('clientName')}, New PIN: {new_pin}")
    
    def test_reset_pin_client_without_phone(self):
        """Test: Reset PIN for client without phone number - should return 400"""
        response = requests.post(
            f"{BASE_URL}/api/admin/clients/{CLIENT_WITHOUT_PHONE}/reset-pin",
            headers={"Content-Type": "application/json"}
        )
        
        # Status code should be 400
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        
        data = response.json()
        
        # Should have error message
        assert "error" in data, "Response should include error message"
        assert "هاتف" in data.get("error", ""), "Error should mention phone number"
        
        print(f"✅ Correctly rejected client without phone - Error: {data.get('error')}")
    
    def test_reset_pin_non_existent_client(self):
        """Test: Reset PIN for non-existent client - should return 404"""
        response = requests.post(
            f"{BASE_URL}/api/admin/clients/{NON_EXISTENT_CLIENT}/reset-pin",
            headers={"Content-Type": "application/json"}
        )
        
        # Status code should be 404
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        
        data = response.json()
        
        # Should have error message
        assert "error" in data, "Response should include error message"
        
        print(f"✅ Correctly returned 404 for non-existent client - Error: {data.get('error')}")
    
    def test_reset_pin_generates_unique_pins(self):
        """Test: Multiple reset PIN calls should generate different PINs"""
        pins = []
        
        for i in range(3):
            response = requests.post(
                f"{BASE_URL}/api/admin/clients/{CLIENT_WITH_PHONE}/reset-pin",
                headers={"Content-Type": "application/json"}
            )
            
            assert response.status_code == 200, f"Request {i+1} failed with status {response.status_code}"
            
            data = response.json()
            if "newPin" in data:
                pins.append(data["newPin"])
        
        # At least 2 out of 3 PINs should be different (statistically very likely)
        unique_pins = set(pins)
        assert len(unique_pins) >= 2, f"Expected at least 2 unique PINs, got {len(unique_pins)}: {pins}"
        
        print(f"✅ Generated {len(unique_pins)} unique PINs out of 3 attempts: {pins}")


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_status_endpoint(self):
        """Test: /api/status endpoint should be accessible"""
        response = requests.get(f"{BASE_URL}/api/status")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "connected" in data, "Status should include 'connected' field"
        assert "running" in data, "Status should include 'running' field"
        
        print(f"✅ API status endpoint working - Connected: {data.get('connected')}")
    
    def test_registered_clients_endpoint(self):
        """Test: /api/ai/registered-clients endpoint should return clients"""
        response = requests.get(f"{BASE_URL}/api/ai/registered-clients")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, dict), "Response should be a dictionary of clients"
        
        # Verify test clients exist
        assert CLIENT_WITH_PHONE in data, f"Test client {CLIENT_WITH_PHONE} should exist"
        assert CLIENT_WITHOUT_PHONE in data, f"Test client {CLIENT_WITHOUT_PHONE} should exist"
        
        print(f"✅ Registered clients endpoint working - Found {len(data)} clients")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
