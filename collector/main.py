#!/usr/bin/env python3
import sys
import argparse
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from collector.config import config
from collector.watcher import LogWatcherService

def cmd_start(args):
    """실시간 로그 감시 데몬 실행"""
    service = LogWatcherService()
    service.start()

def cmd_scan(args):
    """1회 즉시 스캔 및 동기화"""
    service = LogWatcherService()
    service.scan_all_existing()

def cmd_status(args):
    """현재 수집기 상태 및 설정 정보 출력"""
    print("=" * 50)
    print(" 🚀 Agent Token Tracker - Collector Status")
    print("=" * 50)
    print(f"Device Name       : {config.device_name}")
    print(f"Supabase Configured: {'✅ YES' if config.is_supabase_configured else '⚠️ NO (Local Offline Queue Only)'}")
    if config.is_supabase_configured:
        print(f"Supabase URL      : {config.supabase_url}")
    print(f"Config File Path  : {config.config_path}")
    print(f"Offline DB Path   : {config.offline_db_path}")
    print("\n[Monitored Agent Paths]")
    for agent, path in config.log_paths.items():
        exists = "✅ Exists" if Path(path).expanduser().exists() else "❌ Not found"
        print(f" - {agent:<14}: {path} ({exists})")
    print("=" * 50)

def cmd_config(args):
    """설정 변경"""
    if args.device:
        config.device_name = args.device
        print(f"[Config] Device name set to: {args.device}")
    if args.supabase_url:
        config.supabase_url = args.supabase_url
        print(f"[Config] Supabase URL updated.")
    if args.supabase_key:
        config.supabase_key = args.supabase_key
        print(f"[Config] Supabase Key updated.")
    config.save()
    print("[Config] Saved to configuration file.")

def main():
    parser = argparse.ArgumentParser(description="Agent Token Tracker - Local Log Collector Daemon")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Start daemon
    subparsers.add_parser("start", help="Start real-time log monitoring daemon")
    
    # Scan once
    subparsers.add_parser("scan", help="Perform one-time scan and sync")

    # Status
    subparsers.add_parser("status", help="Show current configuration and status")

    # Config
    config_parser = subparsers.add_parser("config", help="Update configuration")
    config_parser.add_argument("--device", help="Set device name")
    config_parser.add_argument("--supabase-url", help="Set Supabase project URL")
    config_parser.add_argument("--supabase-key", help="Set Supabase Anon/Service Key")

    args = parser.parse_args()

    if args.command == "start":
        cmd_start(args)
    elif args.command == "scan":
        cmd_scan(args)
    elif args.command == "status":
        cmd_status(args)
    elif args.command == "config":
        cmd_config(args)
    else:
        # Default action: start
        cmd_start(args)

if __name__ == "__main__":
    main()
