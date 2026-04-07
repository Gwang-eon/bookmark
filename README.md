# Chrome Bookmark Organizer

크롬 `Bookmarks` JSON 파일을 읽어서 다음 기준으로 정리할 수 있는 로컬 웹 도구다.

- 죽은 링크 탐지
- 중복 링크 그룹화
- 주제별 분류
- 도메인별 분류
- 중요도 점수 계산
- 정리된 HTML/JSON 다운로드
- `Bookmarks` 파일 직접 적용
- gzip 백업 보관 및 툴 내 롤백

## 실행

```bash
npm start
```

기본 포트는 `3210`이며 브라우저에서 `http://localhost:3210`으로 접속하면 된다.

## 사용 방식

1. 크롬 북마크 파일을 업로드하거나 파일 경로를 입력한다.
   실행 시점에 일반적인 Chrome 프로필 경로를 자동으로 탐지해 첫 경로를 채운다.
2. 죽은 링크 검사 모드를 고른다.
3. 분석 결과에서 죽은 링크, 중복, 도메인, 주제, 중요도 목록을 확인한다.
4. 원하는 정리 방식으로 HTML 또는 JSON을 다운로드한다.
5. 경로 기반으로 작업했다면 현재 `Bookmarks` 파일에 직접 적용할 수 있다.
6. 적용 전 원본은 자동으로 gzip 백업되며, 같은 화면에서 롤백할 수 있다.

## 북마크 파일 기본 위치

- Linux: `~/.config/google-chrome/Default/Bookmarks`
- macOS: `~/Library/Application Support/Google/Chrome/Default/Bookmarks`
- Windows: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks`

## 내보내기 형식

- `HTML`: Chrome의 "북마크 및 설정 가져오기"로 다시 불러오기 쉬운 형식
- `JSON`: 분석 리포트 및 추가 가공용 형식

## 직접 적용과 롤백

- `직접 적용`은 현재 `Bookmarks` 파일을 정리된 Chrome 내부 JSON으로 덮어쓴다.
- 적용 직전 원본 파일은 `~/.chrome-bookmark-organizer/backups` 아래에 gzip으로 보관된다.
- 백업 목록은 UI에서 조회할 수 있고, 원하는 시점으로 즉시 롤백할 수 있다.
- Chrome이 실행 중이면 다시 덮어쓸 수 있으므로, 적용 전에는 Chrome 종료를 권장한다.

## 중요도 점수

중요도는 휴리스틱이다. 다음 요소를 함께 반영한다.

- 북마크바 여부
- 폴더 깊이
- 폴더 내 위치
- 추가 시점
- 폴더 이름의 우선순위 힌트
- HTTPS 여부
- 중복 패널티
- 죽은 링크 패널티

## 한계

- 주제 분류는 규칙 기반이다.
- 죽은 링크 검사는 네트워크 환경에 따라 느릴 수 있다.
- Chrome UI는 JSON 직접 가져오기를 지원하지 않아서, 실제 재가져오기에는 HTML 내보내기가 더 안전하다.
