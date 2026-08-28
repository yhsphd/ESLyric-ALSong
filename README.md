# ALSong Lyrics Searcher for ESLyric

foobar2000의 가사 컴포넌트인 [**ESLyric(`foo_uie_eslyric`)**](https://github.com/ESLyric/release)에서 작동하는 **알송(ALSong)** 실시간 싱크가사용 searcher 스크립트입니다.

---

## 주요 기능

* **알송 실시간 싱크가사 검색**: 한국 가요 및 한국어로 번역된 팝송, 애니송, J-POP 등의 방대한 가사 데이터를 보유한 알송 가사 DB와 실시간 연동
* **자동 가사 적합도 랭킹**: 재생 중인 곡 정보(제목, 가수, 앨범)와 가장 잘 맞는 가사를 자동으로 1순위 선택
* **텍스트 정규화**: 알송 고유의 줄바꿈 및 특수문자 깨짐 현상 없이 깨끗한 가사 출력

---

## 호환성 및 실행 환경 (Compatibility)

> **중요**: 본 스크립트는 **foobar2000 및 ESLyric (`foo_uie_eslyric`) 컴포넌트 전용**입니다.  
> ESLyric 컴포넌트가 제공하는 전역 객체(`request`, `meta`, `man`)를 사용하므로, **일반적인 Node.js나 브라우저 환경에서는 직접 실행되지 않습니다.**

* **지원 플레이어**: foobar2000 v1.x / v2.x (32-bit / 64-bit)
* **필수 컴포넌트**: [ESLyric (`foo_uie_eslyric`)](https://github.com/ESLyric/release) v1.0.x 이상
* **타겟 JavaScript 엔진**: **QuickJS-ng**

---

## 설치 방법 (Installation)

1. 이 저장소의 [`searcher/ALSong.js`](./searcher/ALSong.js) 파일을 다운로드합니다. (Download Raw File)

1. 자신의 foobar2000 설치 형태에 맞춰 아래 폴더를 찾아 들어갑니다.
   * **일반 설치 (기본값)**:
      1. 키보드의 `Windows 키 + R`을 눌러 실행 창을 엽니다.
      1. 아래 경로를 그대로 복사하여 입력하고 엔터를 칩니다:
         ```text
         %APPDATA%\foobar2000-v2\eslyric-data\scripts\searcher
         ```
      1. 열린 폴더 안에 다운로드한 **`ALSong.js`** 파일을 복사해 넣습니다.  
         *(만약 `searcher` 폴더가 없다면 새로 만듭니다.)*

   * **포터블(Portable) 설치**:
      1. foobar2000이 설치된 폴더로 이동합니다.
      1. `profile\eslyric-data\scripts\searcher` 경로로 들어갑니다.
      1. 다운로드한 **`ALSong.js`** 파일을 복사해 넣습니다.

1. foobar2000을 실행합니다. (이미 켜져 있다면 완전히 종료 후 재실행합니다.)
1. 상단 메뉴에서 `File` ➔ `Preferences` (단축키: `Ctrl + P`)를 엽니다.
1. 좌측 메뉴에서 `Tools` ➔ `ESLyric` ➔ `Lyric Options` ➔ `Lyric Sources` 탭을 선택합니다.
1. 가사 검색기 목록에 **`ALSong`**이 정상적으로 나타나는지 확인한 후, 체크박스를 눌러 활성화합니다.
1. `ALSong`을 우클릭하고 **`Move Up` (단축키: `Ctrl + ↑`) 버튼을 눌러 목록 상단에 배치**하면 알송 가사가 최우선으로 검색됩니다.
1. `Lyric Options` ➔ `Search Settings` 탭을 선택합니다.
1. `Field Processing` 섹션의 `To Simplified Chinese` 항목을 체크 해제합니다. 해당 항목이 활성화되어 있으면 일본어 메타데이터의 한자가 간체자로 자동 변환되어 알송 싱크가사가 검색되지 않을 수 있습니다.

---

## 가사 검색 및 매칭 알고리즘

1. **알송 서버 실시간 검색 (SOAP 통신)**  
   재생 중인 음원의 제목과 가수명을 바탕으로 알송 가사 웹서비스(`Service1.asmx`)에 표준 SOAP 1.2 검색 요청을 전송합니다.

1. **응답 데이터 정제 및 파싱**  
   서버에서 받은 응답에서 곡 고유 ID, 제목, 가수, 앨범, 가사 본문을 추출합니다.  
   이때 알송 특유의 `<br>`, `&lt;br&gt;` 줄바꿈 태그와 XML 특수문자 엔티티(`&amp;`, `&quot;` 등)를 표준 줄바꿈과 텍스트로 정제합니다.

1. **자동 점수화 (Scoring)**  
   각 가사 후보마다 현재 재생 중인 음악과 얼마나 일치하는지 종합 점수(100점 만점)를 계산합니다:
   * **제목 유사도 (45점)**: 제목이 완벽히 같거나 유사할수록 높은 점수를 부여합니다. 두 글자씩 쌍을 지어 비교하는 Bigram 유사도(Sørensen-Dice) 알고리즘을 적용하여 띄어쓰기나 미세한 표기 차이가 있어도 유연하게 매칭합니다.
   * **가수명 유사도 (30점)**: 가수 이름이 정확히 일치하거나 포함되는지 확인합니다.
   * **앨범명 일치 (10점)**: 앨범 정보까지 일치한다면 추가 가산점을 부여합니다.
   * **싱크가사 품질 (15점)**: 시간 타임태그(`[mm:ss.xx]`)가 포함되어 있고 줄 수가 충분한 완성도 높은 싱크가사에 보너스 점수를 부여합니다.

1. **우선순위 자동 정렬 및 등록**
   가사를 점수 순서대로 ESLyric에 전달하여 foobar2000이 자동으로 가장 정확한 싱크가사를 표시하도록 합니다.

---

## 라이선스 (License)

이 프로젝트는 [MIT License](./LICENSE)를 따릅니다.
