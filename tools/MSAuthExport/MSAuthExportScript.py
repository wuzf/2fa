#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Microsoft Authenticator PhoneFactor 数据库导出为 otpauth:// 格式

使用方法:
  python3 tools/MSAuthExport/MSAuthExportScript.py

输出文件:
  msauth-export-<timestamp>.txt（在脚本目录生成）

详细说明请参考: tools/MSAuthExport/README.md
"""

import sqlite3
import os
import sys
import base64
from datetime import datetime
from urllib.parse import quote


def base64_to_base32(base64_str):
    """
    将 Base64 编码的字符串转换为 Base32 编码
    用于处理 Microsoft 个人账户（account_type=1）的密钥
    """
    try:
        # 解码 Base64
        decoded_bytes = base64.b64decode(base64_str)

        # Base32 字母表
        base32_alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

        # 转换为 Base32
        result = []
        bits = 0
        bit_count = 0

        for byte in decoded_bytes:
            bits = (bits << 8) | byte
            bit_count += 8

            while bit_count >= 5:
                bit_count -= 5
                index = (bits >> bit_count) & 0x1F
                result.append(base32_alphabet[index])

        # 处理剩余的位
        if bit_count > 0:
            index = (bits << (5 - bit_count)) & 0x1F
            result.append(base32_alphabet[index])

        return ''.join(result)
    except Exception as e:
        print(f'Base64 转换错误: {e}')
        return None


# 数据库路径（固定位置）
script_dir = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(script_dir, 'databases', 'PhoneFactor')

if not os.path.exists(DB_PATH):
    print('错误: 未找到 PhoneFactor 数据库文件')
    print('\n请将数据库文件放在: tools/MSAuthExport/databases/PhoneFactor')
    print('提示: 如果有 PhoneFactor-shm 和 PhoneFactor-wal 文件，请一起复制')
    print('     （脚本运行时会自动合并 WAL 文件到主数据库）')
    print('\n详细说明请参考: tools/MSAuthExport/README.md')
    sys.exit(1)

DB_PATH = os.path.normpath(DB_PATH)

# 生成输出文件名（带时间戳），确保在脚本目录下创建
timestamp = datetime.now().strftime('%Y-%m-%d-%H%M%S')
output_filename = f'msauth-export-{timestamp}.txt'
OUTPUT_FILE = os.path.join(script_dir, output_filename)

print('=' * 60)
print('Microsoft Authenticator 导出工具')
print('=' * 60)
print(f'输出文件: {OUTPUT_FILE}')
print('=' * 60)

# 连接到 SQLite 数据库
try:
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 查询所有有效账户（包括所有 account_type）
    cursor.execute("""
        SELECT name, username, oath_secret_key, account_type
        FROM accounts
        WHERE oath_secret_key IS NOT NULL
          AND oath_secret_key != ''
        ORDER BY account_type, name, username
    """)

    rows = cursor.fetchall()

    if not rows:
        print('\n未找到任何有效账户')
        conn.close()
        sys.exit(0)

    print(f'\n找到 {len(rows)} 个有效账户\n')

    # 生成 otpauth:// URLs
    otpauth_urls = []

    for index, row in enumerate(rows, 1):
        name, username, secret_key, account_type = row

        # 根据 account_type 处理密钥
        if account_type == 1:
            # Microsoft 个人账户，需要 Base64 → Base32 转换
            secret_cleaned = secret_key.replace(' ', '').replace('\t', '').replace('\n', '').replace('\r', '')
            secret = base64_to_base32(secret_cleaned)
            if secret is None:
                print(f'  [{index:2d}] 转换失败，跳过: {name or "Unknown"} {username or ""}')
                continue
            account_type_label = '(account_type=1, Microsoft)'
        elif account_type == 2:
            # 企业账户，使用 SHA256
            secret = secret_key.replace(' ', '').replace('\t', '').replace('\n', '').replace('\r', '').upper()
            account_type_label = '(account_type=2, SHA256)'
        else:
            # 标准 TOTP 账户 (account_type=0)
            secret = secret_key.replace(' ', '').replace('\t', '').replace('\n', '').replace('\r', '').upper()
            account_type_label = '(account_type=0)'

        # URL 编码
        issuer = name or 'Unknown'
        account = username or ''

        issuer_encoded = quote(issuer)
        account_encoded = quote(account) if account else ''

        # 构建 label（格式：issuer:account）
        if account:
            label = f'{issuer_encoded}:{account_encoded}'
        else:
            label = issuer_encoded

        # 根据 account_type 选择算法
        algorithm = 'SHA256' if account_type == 2 else 'SHA1'

        # 构建 otpauth:// URL
        otpauth_url = f'otpauth://totp/{label}?secret={secret}&digits=6&period=30&algorithm={algorithm}&issuer={issuer_encoded}'

        otpauth_urls.append(otpauth_url)

        # 显示进度
        try:
            display_issuer = issuer[:24] if len(issuer) <= 26 else issuer[:24] + '..'
            display_account = account[:24] if len(account) <= 26 else account[:24] + '..'
            print(f'  [{index:2d}] {display_issuer.ljust(26)} {display_account.ljust(26)} {account_type_label}')
        except (UnicodeEncodeError, UnicodeDecodeError):
            print(f'  [{index:2d}] [Account {index}] {account_type_label}')

    # 写入文件
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for url in otpauth_urls:
            f.write(url + '\n')

    conn.close()

    print('\n' + '=' * 60)
    print(f'成功导出 {len(otpauth_urls)} 个账户到文件: {OUTPUT_FILE}')
    print('=' * 60)
    print('\n下一步操作:')
    print('  1. 在 2FA Manager 中点击 "导入" 按钮')
    print(f'  2. 选择或拖拽文件: {OUTPUT_FILE}')
    print(f'  3. 应该成功导入所有 {len(otpauth_urls)} 个账户\n')

except sqlite3.Error as e:
    print(f'\n数据库错误: {e}')
    sys.exit(1)
except Exception as e:
    print(f'\n错误: {e}')
    sys.exit(1)
