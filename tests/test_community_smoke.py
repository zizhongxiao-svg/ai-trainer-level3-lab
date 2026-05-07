import importlib
import json

from fastapi.testclient import TestClient


def test_community_startup_and_operation_files(tmp_path, monkeypatch):
    db_path = tmp_path / "trainer.db"
    monkeypatch.setenv("TRAINER_DB_PATH", str(db_path))
    monkeypatch.setenv("TRAINER_DATA_DIR", str(tmp_path / "runtime"))
    monkeypatch.setenv("TRAINER_EDITION", "community")

    from app import server

    importlib.reload(server)
    with TestClient(server.app) as client:
        edition = client.get("/api/edition").json()
        assert edition["edition"] == "community"
        assert edition["features"]["ai_grading"] is False
        assert edition["features"]["wechat_gate"] is False

        register = client.post(
            "/api/auth/register",
            json={"username": "tester", "display_name": "Tester", "password": "pass"},
        )
        assert register.status_code == 200
        token = register.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        ops = client.get("/api/operations", headers=headers)
        assert ops.status_code == 200
        assert ops.json()["total"] == 40

        files = client.get("/api/operations/1/files", headers=headers)
        assert files.status_code == 200
        assert any(f["name"] == "patient_data.csv" for f in files.json()["files"])

        model_files = client.get("/api/operations/26/files", headers=headers)
        assert model_files.status_code == 200
        assert any(f["name"] == "resnet.onnx" for f in model_files.json()["files"])
