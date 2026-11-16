import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CLASSES,
  STORAGE,
  compressImage,
  dateLabel,
  downloadCsv,
  fullName,
  generateId,
  initials,
  qrDataUri,
  readStore,
  timeLabel,
  todayKey,
} from './utils.js';

const VIEW_ROLES = {
  dashboard: ['Security'],
  students: ['Security'],
  gate: ['Security'],
  attendance: ['Security'],
  reports: ['Security'],
  classes: ['Teacher'],
  settings: ['Admin'],
  accounts: ['Admin'],
};

function App() {
  const [students, setStudents] = useState(() => readStore(STORAGE.students, []));
  const [attendance, setAttendance] = useState(() => readStore(STORAGE.attendance, []));
  const [settings, setSettings] = useState(() => readStore(STORAGE.settings, { name: 'Your Learning Centre', logo: '' }));
  const [accounts, setAccounts] = useState(() => readStore(STORAGE.accounts, []));
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard');
  const [modal, setModal] = useState(null);
  const [modalStudent, setModalStudent] = useState(null);
  const [printingCard, setPrintingCard] = useState(false);
  const [toast, setToast] = useState('');
  const [authError, setAuthError] = useState('');
  const [query, setQuery] = useState('');
  const [attendanceQuery, setAttendanceQuery] = useState('');
  const [gateId, setGateId] = useState('');
  const [gateResult, setGateResult] = useState(null);
  const [scanMode, setScanMode] = useState('manual');
  const [classFilter, setClassFilter] = useState('All classes');
  const [logoBusy, setLogoBusy] = useState(false);
  const toastTimer = useRef(null);

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2800);
  };

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useEffect(() => {
    const records = [
      [STORAGE.students, students],
      [STORAGE.attendance, attendance],
      [STORAGE.settings, settings],
      [STORAGE.accounts, accounts],
    ];
    try {
      records.forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
    } catch (error) {
      notify(error instanceof Error ? `Could not save local preview data: ${error.message}` : 'Could not save local preview data.');
    }
  }, [students, attendance, settings, accounts]);

  const todaysAttendance = useMemo(
    () => attendance.filter((record) => record.date === todayKey()),
    [attendance],
  );
  const filteredStudents = useMemo(() => {
    const search = query.trim().toLowerCase();
    return students.filter((student) => {
      const matchesSearch = !search || `${fullName(student)} ${student.id} ${student.className}`.toLowerCase().includes(search);
      return matchesSearch && (classFilter === 'All classes' || student.className === classFilter);
    });
  }, [students, query, classFilter]);
  const filteredAttendance = useMemo(() => {
    const search = attendanceQuery.trim().toLowerCase();
    return [...todaysAttendance]
      .filter((record) => {
        const student = students.find((item) => item.id === record.studentId);
        return student && (!search || `${fullName(student)} ${student.id}`.toLowerCase().includes(search));
      })
      .sort((left, right) => right.time.localeCompare(left.time));
  }, [todaysAttendance, attendanceQuery, students]);

  function signIn(account) {
    setUser(account);
    if (account.role === 'Security') setView('dashboard');
    else if (account.role === 'Teacher') setView('classes');
    else setView('accounts');
    setAuthError('');
  }

  function onLogin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const number = String(form.get('number')).trim();
    const role = accounts.length ? String(form.get('role')) : 'Admin';

    if (accounts.length === 0) {
      const firstAdmin = { name, number, role: 'Admin', createdAt: new Date().toISOString() };
      setAccounts([firstAdmin]);
      signIn(firstAdmin);
      return;
    }
    const account = accounts.find((item) =>
      item.role === role
      && item.name.toLowerCase() === name.toLowerCase()
      && item.number.toLowerCase() === number.toLowerCase(),
    );
    if (!account) {
      setAuthError('Those details do not match an account for the selected role.');
      return;
    }
    signIn(account);
  }

  function navigate(nextView) {
    if (!user || !VIEW_ROLES[nextView]?.includes(user.role)) {
      notify('You do not have access to that page.');
      return;
    }
    setView(nextView);
    setQuery('');
    setAttendanceQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openCard(student) {
    if (user?.role !== 'Security') {
      notify('Security access is required for student records.');
      return;
    }
    setModalStudent(student);
    setModal('card');
  }

  async function onRegister(event) {
    event.preventDefault();
    if (user?.role !== 'Security') {
      notify('Security access is required to register students.');
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const photoFile = data.get('photo');
      const student = {
        id: generateId(students),
        firstName: String(data.get('firstName')).trim(),
        lastName: String(data.get('lastName')).trim(),
        middleName: String(data.get('middleName')).trim(),
        course: String(data.get('course')).trim(),
        className: String(data.get('className')),
        photo: photoFile?.size ? await compressImage(photoFile) : '',
        createdAt: new Date().toISOString(),
        status: 'active',
      };
      qrDataUri(student.id);
      setStudents((current) => [...current, student]);
      form.reset();
      setModal(null);
      setModalStudent(student);
      setModal('card');
      notify(`${student.id} created for ${student.firstName}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not register this student.');
    }
  }

  function lookupStudent(event) {
    event?.preventDefault();
    if (user?.role !== 'Security') {
      notify('Security access is required for gate lookup.');
      return;
    }
    const id = gateId.trim();
    if (!id) {
      notify('Enter a student ID number first.');
      return;
    }
    const student = students.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!student) {
      setGateResult({ notFound: true });
      return;
    }
    setGateResult({
      student,
      duplicate: todaysAttendance.some((record) => record.studentId === student.id),
    });
  }

  function confirmCheckin() {
    if (user?.role !== 'Security' || !gateResult?.student) {
      notify('Security access is required to record attendance.');
      return;
    }
    if (!gateResult.student.photo) {
      notify('Refer this student for staff verification; no check-in was recorded.');
      return;
    }
    if (todaysAttendance.some((record) => record.studentId === gateResult.student.id)) {
      setGateResult({ student: gateResult.student, duplicate: true });
      return;
    }
    const record = {
      studentId: gateResult.student.id,
      date: todayKey(),
      time: new Date().toISOString(),
      status: 'present',
      checkedBy: user.name,
    };
    setAttendance((current) => [...current, record]);
    setGateResult({ student: gateResult.student, duplicate: true });
    notify(`${gateResult.student.id} checked in successfully.`);
  }

  async function onCreateAccount(event) {
    event.preventDefault();
    if (user?.role !== 'Admin') {
      notify('Only Admin can create staff accounts.');
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('name')).trim();
    const number = String(data.get('number')).trim();
    if (accounts.some((account) => account.number.toLowerCase() === number.toLowerCase())) {
      notify('That number is already assigned to an account.');
      return;
    }
    setAccounts((current) => [...current, {
      name,
      number,
      role: String(data.get('role')),
      createdAt: new Date().toISOString(),
    }]);
    form.reset();
    notify(`Account created for ${name}.`);
  }

  async function onLogoChange(event) {
    setLogoBusy(true);
    try {
      const logo = await compressImage(event.target.files[0]);
      setSettings((current) => ({ ...current, logo }));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load this logo.');
    } finally {
      setLogoBusy(false);
    }
  }

  function exportStudents() {
    if (user?.role !== 'Security') {
      notify('Security access is required for student reports.');
      return;
    }
    const rows = [
      ['Student ID', 'First name', 'Middle name', 'Last name', 'Course', 'Class', 'Registration date', 'Status'],
      ...students.map((student) => [
        student.id,
        student.firstName,
        student.middleName,
        student.lastName,
        student.course,
        student.className,
        dateLabel(student.createdAt),
        student.status,
      ]),
    ];
    downloadCsv('passgate-students.csv', rows);
    notify('CSV report downloaded.');
  }

  function exportAttendance() {
    if (user?.role !== 'Security') {
      notify('Security access is required for attendance reports.');
      return;
    }
    const rows = [
      ['Student ID', 'Student name', 'Class', 'Date', 'Check-in time', 'Checked in by', 'Status'],
      ...todaysAttendance.map((record) => {
        const student = students.find((item) => item.id === record.studentId);
        return student ? [
          student.id,
          fullName(student),
          student.className,
          record.date,
          new Date(record.time).toLocaleTimeString(),
          record.checkedBy || '',
          'Present',
        ] : null;
      }).filter(Boolean),
    ];
    downloadCsv(`passgate-attendance-${todayKey()}.csv`, rows);
    notify('CSV report downloaded.');
  }

  function closeModal() {
    setModal(null);
    setModalStudent(null);
  }

  if (!user) {
    return (
      <>
        <AuthScreen
          firstSetup={accounts.length === 0}
          error={authError}
          onSubmit={onLogin}
        />
        <Toast message={toast} />
      </>
    );
  }

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const navGroups = user.role === 'Security'
    ? [
      { title: 'WORKSPACE', items: [['dashboard', '▦', 'Overview'], ['students', '♙', 'Students'], ['gate', '⌑', 'Gate check-in'], ['attendance', '◷', 'Attendance']] },
      { title: 'MANAGEMENT', items: [['reports', '▥', 'Reports']] },
    ]
    : user.role === 'Teacher'
      ? [{ title: 'WORKSPACE', items: [['classes', '▤', 'Classes & schedule']] }]
      : [{ title: 'MANAGEMENT', items: [['settings', '⚙', 'Centre settings'], ['accounts', '♙', 'Staff accounts']] }];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="PassGate home" onClick={(event) => event.preventDefault()}>
          <BrandMark />
          <span><strong>PassGate</strong><small>STUDENT ACCESS</small></span>
        </a>
        {navGroups.map((group) => (
          <div className="nav-group" key={group.title}>
            <div className="side-label">{group.title}</div>
            <nav className="nav-list" aria-label={group.title.toLowerCase()}>
              {group.items.map(([key, icon, label]) => (
                <button className={`nav-item${view === key ? ' active' : ''}`} key={key} onClick={() => navigate(key)}>
                  <span className="nav-icon">{icon}</span>
                  {label}
                  {key === 'students' && <span className="nav-count">{students.length}</span>}
                </button>
              ))}
            </nav>
          </div>
        ))}
        <div className="sidebar-bottom">
          <div className="plan-card"><span className="plan-icon">✦</span><div><strong>Free to get started</strong><p>Designed for your centre, with no subscription costs.</p></div></div>
          <div className="profile-row">
            <div className="avatar">{initials(user.name)}</div>
            <div className="profile-copy"><strong>{user.name}</strong><span>{user.role}</span></div>
            <button className="more-btn" aria-label="Sign out" onClick={() => { setUser(null); setModal(null); }}>↪</button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong id="breadcrumb-current">{viewLabel(view)}</strong></div>
          <div className="top-actions"><span className="local-badge"><i /> Local preview</span><div className="top-avatar">{initials(user.name)}</div></div>
        </header>

        {view === 'dashboard' && (
          <DashboardView
            user={user}
            students={students}
            attendance={attendance}
            todayAttendance={todaysAttendance}
            todayLabel={todayLabel}
            onRegister={() => setModal('register')}
            onNavigate={navigate}
          />
        )}
        {view === 'students' && (
          <StudentsView
            students={filteredStudents}
            allStudents={students}
            query={query}
            classFilter={classFilter}
            onQuery={setQuery}
            onClassFilter={setClassFilter}
            onRegister={() => setModal('register')}
            onExport={exportStudents}
            onOpenCard={openCard}
          />
        )}
        {view === 'gate' && (
          <GateView
            students={students}
            todaysAttendance={todaysAttendance}
            gateId={gateId}
            onGateId={(value) => { setGateId(value.toUpperCase()); setGateResult(null); }}
            onLookup={lookupStudent}
            result={gateResult}
            scanMode={scanMode}
            onScanMode={(mode) => setScanMode(mode)}
            onConfirm={confirmCheckin}
          />
        )}
        {view === 'attendance' && (
          <AttendanceView
            records={filteredAttendance}
            students={students}
            query={attendanceQuery}
            onQuery={setAttendanceQuery}
            onExport={exportAttendance}
            onNavigate={navigate}
          />
        )}
        {view === 'classes' && (
          <ClassesView onAddClass={() => notify('Class management is next on the build list.')} />
        )}
        {view === 'reports' && (
          <ReportsView onExportStudents={exportStudents} onExportAttendance={exportAttendance} />
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            onChange={(name) => setSettings((current) => ({ ...current, name }))}
            onLogoChange={onLogoChange}
            logoBusy={logoBusy}
            onSave={() => notify('Centre branding saved.')}
          />
        )}
        {view === 'accounts' && (
          <AccountsView accounts={accounts} onSubmit={onCreateAccount} />
        )}
        <footer className="app-footer"><span>PassGate <b>·</b> Student Access</span><span>Built for learning centres <i>✦</i></span></footer>
      </main>

      {modal === 'register' && (
        <RegisterModal onClose={closeModal} onSubmit={onRegister} />
      )}
      {modal === 'card' && modalStudent && (
        <CardModal
          student={modalStudent}
          settings={settings}
          printing={printingCard}
          onClose={closeModal}
          onPrint={() => {
            setPrintingCard(true);
            window.setTimeout(() => {
              window.print();
              setPrintingCard(false);
            }, 100);
          }}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}

function AuthScreen({ firstSetup, error, onSubmit }) {
  return (
    <div className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="brand auth-brand" href="#" onClick={(event) => event.preventDefault()} aria-label="PassGate">
          <BrandMark />
          <span><strong>PassGate</strong><small>STUDENT ACCESS</small></span>
        </a>
        <div className="eyebrow"><span className="eyebrow-dot" /> STAFF ACCESS</div>
        <h1 id="auth-title">{firstSetup ? 'Set up your Admin account' : 'Welcome back'}</h1>
        <p className="auth-description">
          {firstSetup ? 'Create the first Admin account. Admins can add Security and Teacher accounts.' : 'Sign in with the name and number registered for your role.'}
        </p>
        <p className="auth-notice">Local preview only: this demo stores account details in this browser and is not secure authentication.</p>
        <form onSubmit={onSubmit}>
          <label className="form-label" htmlFor="auth-role">Sign in as
            <select className="form-input" id="auth-role" name="role" required disabled={firstSetup} defaultValue={firstSetup ? 'Admin' : 'Security'}>
              <option value="Security">Security</option>
              <option value="Teacher">Teacher</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
          <label className="form-label" htmlFor="auth-name">Full name
            <input className="form-input" id="auth-name" name="name" required maxLength="80" autoComplete="name" placeholder="Your name" />
          </label>
          <label className="form-label" htmlFor="auth-number">Staff / ID number
            <input className="form-input" id="auth-number" name="number" required maxLength="40" autoComplete="username" placeholder="Your number" />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" type="submit">{firstSetup ? 'Create first Admin account' : 'Sign in'}</button>
        </form>
      </section>
    </div>
  );
}

function DashboardView({ user, students, attendance, todayAttendance, todayLabel, onRegister, onNavigate }) {
  const presentToday = todayAttendance.length;
  const weekly = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = todayKey(date);
    return {
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      count: attendance.filter((record) => record.date === key).length,
    };
  });
  const max = Math.max(1, students.length, ...weekly.map((day) => day.count));
  const recent = [...todayAttendance].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 5);
  return (
    <section className="view active-view">
      <div className="page-heading">
        <div><div className="eyebrow"><span className="eyebrow-dot" /> CENTRE OVERVIEW</div><h1>Good morning, {user.name} <span className="wave">✦</span></h1><p className="subheading">Here’s what’s happening at your centre today.</p></div>
        <div className="heading-actions"><div className="date-pill"><span>▦</span><span>{todayLabel}</span></div><button className="primary-button" onClick={onRegister}><span>＋</span> Register student</button></div>
      </div>
      <div className="stat-grid">
        <StatCard label="Total students" value={students.length} icon="♙" color="blue" foot="Registered students" />
        <StatCard label="Present today" value={presentToday} icon="✓" color="green" foot="Checked in today" />
        <StatCard label="Not checked in" value={Math.max(0, students.length - presentToday)} icon="◷" color="amber" foot="Awaiting arrival" />
        <StatCard label="Active classes" value={DEFAULT_CLASSES.length} icon="▤" color="violet" foot="Classes this week" />
      </div>
      <div className="dashboard-grid">
        <section className="panel attendance-panel">
          <div className="panel-heading"><div><h2>Attendance overview</h2><p>Student check-ins across the week</p></div><span className="select-chip">This week</span></div>
          <div className="chart-legend"><span><i className="legend-present" /> Present</span><span><i className="legend-absent" /> Not checked in</span></div>
          <div className="chart-wrap"><div className="y-axis"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className="chart"><div className="chart-gridline" /><div className="chart-gridline" /><div className="chart-gridline" /><div className="chart-gridline" /><div className="chart-bars">{weekly.map((day) => <div className="bar-group" title={`${day.label}: ${day.count} check-ins`} key={day.key}><div className="bar present" style={{ height: `${day.count ? Math.max(4, day.count / max * 100) : 2}%` }} /><div className="bar" style={{ height: `${students.length ? Math.max(2, (students.length - day.count) / max * 100) : 2}%` }} /></div>)}</div><div className="x-axis">{weekly.map((day) => <span key={day.key}>{day.label}</span>)}</div></div></div>
        </section>
        <section className="panel sessions-panel"><div className="panel-heading"><div><h2>Today’s sessions</h2><p>Scheduled classes for today</p></div><button className="text-button" onClick={() => onNavigate('classes')}>View schedule <span>→</span></button></div><SessionList /></section>
      </div>
      <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent check-ins</h2><p>The latest student arrivals at your gate</p></div><button className="text-button" onClick={() => onNavigate('attendance')}>View attendance <span>→</span></button></div><div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>CLASS</th><th>ARRIVAL TIME</th><th>STATUS</th></tr></thead><tbody>{recent.length ? recent.map((record) => {
        const student = students.find((item) => item.id === record.studentId);
        return student ? <tr key={record.studentId}><td><StudentCell student={student} /><span className="id-code">{student.id}</span></td><td>{student.className}</td><td>{timeLabel(record.time)}</td><td><span className="status-pill present">● Present</span></td></tr> : null;
      }) : <tr><td className="gate-empty-note" colSpan="4">Check-ins will appear here after a student is verified at the gate.</td></tr>}</tbody></table></div></section>
    </section>
  );
}

function StatCard({ label, value, icon, color, foot }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${color}-icon`}>{icon}</span></div><div className="stat-number">{value}</div><div className="stat-foot"><span className={`status-dot ${color}-dot`} /> {foot}</div><div className={`stat-decoration deco-${color}`} /></article>;
}

function SessionList() {
  return <div className="session-list">{DEFAULT_CLASSES.map((item, index) => <div className="session-item" key={item.name}><span className="session-time">{item.time.split(' – ')[0]}</span><span className="session-line" style={{ background: ['#79a9df', '#8ac0a2', '#d6ad68'][index] }} /><div className="session-info"><strong>{item.name}</strong><span>{item.time} · {item.students || 0} students</span></div><span className="session-status">Scheduled</span></div>)}</div>;
}

function StudentsView({ students, allStudents, query, classFilter, onQuery, onClassFilter, onRegister, onExport, onOpenCard }) {
  return (
    <section className="view active-view">
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PEOPLE</div><h1>Students</h1><p className="subheading">Register students, manage profiles and print unique ID cards.</p></div><button className="primary-button" onClick={onRegister}><span>＋</span> Register student</button></div>
      <section className="panel list-panel">
        <div className="list-toolbar"><div className="search-box"><span>⌕</span><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search by name or student ID" /></div><div className="toolbar-right"><select className="select-chip" value={classFilter} onChange={(event) => onClassFilter(event.target.value)}><option>All classes</option>{DEFAULT_CLASSES.map((item) => <option key={item.name}>{item.name}</option>)}</select><button className="secondary-button" onClick={onExport}>↓ Export</button></div></div>
        <div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>STUDENT ID</th><th>CLASS</th><th>REGISTERED</th><th>STATUS</th><th /></tr></thead><tbody>{students.map((student) => <tr key={student.id}><td><StudentCell student={student} /></td><td><span className="id-code">{student.id}</span></td><td>{student.className}</td><td>{dateLabel(student.createdAt)}</td><td><span className="status-pill active">● Active</span></td><td><button className="row-action" aria-label={`View ${fullName(student)}'s ID card`} onClick={() => onOpenCard(student)}>▣</button></td></tr>)}</tbody></table>
          {students.length === 0 && <div className="empty-state"><div className="empty-icon">♙</div><strong>{allStudents.length ? 'No matching students' : 'No students yet'}</strong><p>{allStudents.length ? 'Try another search or class filter.' : 'Register your first student to create their unique ID and QR card.'}</p>{allStudents.length === 0 && <button className="primary-button" onClick={onRegister}>Register a student</button>}</div>}
        </div>
        <div className="table-footer"><span>Showing {students.length} of {allStudents.length} students</span><span>Student IDs are permanent and unique</span></div>
      </section>
    </section>
  );
}

function StudentCell({ student }) {
  return <div className="student-cell">{student.photo ? <img className="student-avatar" src={student.photo} alt="" /> : <div className="student-avatar">{initials(fullName(student))}</div>}<div><strong>{fullName(student)}</strong><span>{student.course}</span></div></div>;
}

function GateView({ students, todaysAttendance, gateId, onGateId, onLookup, result, scanMode, onScanMode, onConfirm }) {
  const recent = [...todaysAttendance].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 5);
  const percent = students.length ? Math.round(todaysAttendance.length / students.length * 100) : 0;
  const student = result?.student;
  return (
    <section className="view active-view">
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> FRONT DESK</div><h1>Gate check-in</h1><p className="subheading">Look up a student, verify their identity and record their arrival.</p></div><div className="gate-clock"><span className="live-dot" /><Clock /></div></div>
      <div className="gate-layout">
        <section className="panel lookup-panel">
          <div className="lookup-intro"><div className="gate-shield">⌑</div><div><h2>Find a student</h2><p>Scan the student’s QR code or enter their ID number below.</p></div></div>
          <div className="scan-tabs"><button className={`scan-tab${scanMode === 'manual' ? ' active' : ''}`} onClick={() => onScanMode('manual')}>Enter ID</button><button className={`scan-tab${scanMode === 'camera' ? ' active' : ''}`} onClick={() => onScanMode('camera')}>Scan QR code</button></div>
          {scanMode === 'manual' ? <form className="scan-content" onSubmit={onLookup}><label htmlFor="gate-id">Student ID number</label><div className="id-input-wrap"><span>⌕</span><input id="gate-id" value={gateId} onChange={(event) => onGateId(event.target.value)} placeholder="e.g. PG-26-000001" autoComplete="off" /><button className="primary-button" type="submit">Find student <span>→</span></button></div><p className="field-hint">The student’s profile will appear for a visual identity check.</p></form> : <div className="scan-content"><div className="camera-placeholder"><div className="camera-frame"><span>▣</span></div><strong>Camera scanning is coming next</strong><p>Use manual ID entry for now. QR cards are ready to scan with a compatible scanner.</p></div></div>}
          {result && <GateResult result={result} onConfirm={onConfirm} />}
        </section>
        <aside className="gate-side">
          <section className="panel gate-today"><div className="panel-heading"><div><h2>Today at the gate</h2><p>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div><span className="gate-live-pill"><i /> LIVE</span></div><div className="gate-total"><strong>{todaysAttendance.length}</strong><span>students checked in</span></div><div className="gate-progress"><div style={{ width: `${percent}%` }} /></div><div className="gate-progress-caption"><span>Attendance progress</span><strong>{percent}%</strong></div></section>
          <section className="panel gate-recent"><div className="panel-heading"><div><h2>Recent arrivals</h2><p>Today’s check-in activity</p></div></div><div className="gate-recent-list">{recent.length ? recent.map((record) => {
            const item = students.find((entry) => entry.id === record.studentId);
            return item && <div className="gate-recent-item" key={record.studentId}><div className="student-avatar">{initials(fullName(item))}</div><div className="gate-recent-copy"><strong>{fullName(item)}</strong><span>{item.className}</span></div><span className="gate-recent-time">{timeLabel(record.time)}</span></div>;
          }) : <div className="gate-empty-note">No arrivals recorded yet today.</div>}</div></section>
        </aside>
      </div>
    </section>
  );
}

function GateResult({ result, onConfirm }) {
  if (result.notFound) {
    return <div className="gate-result error"><div className="result-header"><div className="gate-shield">!</div><div className="result-name"><strong>No student found</strong><span>Check the ID number and try again</span></div></div><div className="result-message">This ID is not in the centre’s student register. No attendance was recorded.</div></div>;
  }
  const { student, duplicate } = result;
  return (
    <div className={`gate-result${duplicate ? ' success' : ''}`}>
      <div className="result-header">{student.photo ? <img className="student-avatar" src={student.photo} alt="" /> : <div className="student-avatar">{initials(fullName(student))}</div>}<div className="result-name"><strong>{fullName(student)}</strong><span>{student.id}</span></div><span className="status-pill active">● Active</span></div>
      {duplicate ? <div className="result-message">Already checked in today. No duplicate record created.</div> : <div className="result-message" style={{ background: student.photo ? '#eef8f2' : '#fff6e5', color: student.photo ? '#348c68' : '#b17c23' }}>{student.photo ? 'Student record found. Compare the photograph with the person at the gate.' : 'No student photo is on file. Refer to staff for identity verification; do not check in from an ID number alone.'}</div>}
      <div className="result-details"><div><span>Course / programme</span><strong>{student.course}</strong></div><div><span>Assigned class</span><strong>{student.className}</strong></div></div>
      <div className="verify-hint"><b>Identity check:</b> {student.photo ? 'Compare the student with the registered photograph before confirming entry.' : 'A staff member must verify this student in person.'}</div>
      {!duplicate && student.photo && <button className="primary-button confirm-checkin" onClick={onConfirm}>✓ Confirm identity & check in</button>}
    </div>
  );
}

function AttendanceView({ records, students, query, onQuery, onExport, onNavigate }) {
  return (
    <section className="view active-view">
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> DAILY RECORDS</div><h1>Attendance</h1><p className="subheading">Check-in history and daily attendance records.</p></div><button className="secondary-button" onClick={onExport}>↓ Export report</button></div>
      <section className="panel list-panel"><div className="list-toolbar"><div className="search-box"><span>⌕</span><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search student or ID" /></div><div className="toolbar-right"><span className="select-chip">Today</span></div></div>
        <div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>STUDENT ID</th><th>CLASS</th><th>ARRIVAL TIME</th><th>CHECKED IN BY</th><th>STATUS</th></tr></thead><tbody>{records.map((record) => {
          const student = students.find((item) => item.id === record.studentId);
          return student && <tr key={`${record.studentId}-${record.time}`}><td><StudentCell student={student} /></td><td><span className="id-code">{student.id}</span></td><td>{student.className}</td><td>{timeLabel(record.time)}</td><td>{record.checkedBy || 'Security'}</td><td><span className="status-pill present">● Present</span></td></tr>;
        })}</tbody></table>
          {records.length === 0 && <div className="empty-state"><div className="empty-icon">◷</div><strong>No attendance recorded today</strong><p>Confirmed gate check-ins will show up here.</p><button className="secondary-button" onClick={() => onNavigate('gate')}>Open gate check-in</button></div>}
        </div><div className="table-footer"><span>{records.length} check-in{records.length === 1 ? '' : 's'}</span><span>Check-in only · No check-out required</span></div>
      </section>
    </section>
  );
}

function ClassesView({ onAddClass }) {
  return (
    <section className="view active-view">
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> LEARNING</div><h1>Classes & schedule</h1><p className="subheading">Organize classes and their weekly timetable.</p></div><button className="primary-button" onClick={onAddClass}>＋ Add class</button></div>
      <div className="info-callout"><span>✦</span><p>Create centre-specific sessions and schedules here. Class management is the next build step; this preview includes sample sessions.</p></div>
      <section className="panel class-panel"><div className="panel-heading"><div><h2>Your classes</h2><p>Class list and weekly schedule</p></div></div><div className="class-grid">{DEFAULT_CLASSES.map((item) => <article className="class-card" key={item.name}><div className={`class-color ${item.color}`} /><h3>{item.name}</h3><p>{item.days}</p><div className="class-meta"><span>◷ {item.time}</span><span>Schedule</span></div></article>)}</div></section>
    </section>
  );
}

function ReportsView({ onExportStudents, onExportAttendance }) {
  return (
    <section className="view active-view">
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> INSIGHTS</div><h1>Reports</h1><p className="subheading">Download attendance and student lists for your centre.</p></div></div>
      <div className="report-grid"><article className="panel report-card"><div className="report-icon report-blue">▥</div><h2>Student directory</h2><p>Download registered students and their unique ID numbers as a CSV file.</p><button className="secondary-button" onClick={onExportStudents}>Download CSV <span>↓</span></button></article><article className="panel report-card"><div className="report-icon report-green">◷</div><h2>Daily attendance</h2><p>Export today’s student arrivals, classes and recorded check-in times.</p><button className="secondary-button" onClick={onExportAttendance}>Download CSV <span>↓</span></button></article></div>
      <div className="info-callout"><span>i</span><p>PDF and Excel exports are planned. CSV files open in Excel and other spreadsheet applications.</p></div>
    </section>
  );
}

function SettingsView({ settings, onChange, onLogoChange, logoBusy, onSave }) {
  const previewStudent = { firstName: 'Amina', lastName: 'Otieno', id: 'PG-26-000001', course: 'Computer Studies', className: 'Computer Basics' };
  return (
    <section className="view active-view">
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> CUSTOMIZATION</div><h1>Centre settings</h1><p className="subheading">Set the name and logo displayed on every student ID card.</p></div><button className="primary-button" onClick={onSave}>Save changes <span>✓</span></button></div>
      <div className="settings-layout">
        <section className="panel settings-form"><div className="panel-heading"><div><h2>Centre identity</h2><p>This branding will appear on student ID cards.</p></div></div><label className="form-label" htmlFor="centre-name">Centre or company name</label><input id="centre-name" className="form-input" maxLength="48" value={settings.name || ''} onChange={(event) => onChange(event.target.value)} placeholder="e.g. Bright Future Learning Centre" /><p className="field-hint">If no logo is added, the centre name will be used as the card’s main brand.</p><label className="form-label logo-label" htmlFor="logo-file">Centre logo <span className="optional">OPTIONAL</span></label><div className="logo-upload-row"><div className="logo-preview">{settings.logo ? <img src={settings.logo} alt="Centre logo" /> : <span>＋</span>}</div><div><label className="upload-button" htmlFor="logo-file">{logoBusy ? 'Loading…' : 'Upload logo'}</label><input className="visually-hidden" type="file" id="logo-file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onLogoChange} /><p className="field-hint">PNG, JPG or SVG · Square logos work best</p></div></div></section>
        <section className="panel preview-panel"><div className="panel-heading"><div><h2>Card preview</h2><p>Branding on the front of the student card</p></div><span className="preview-tag">LIVE PREVIEW</span></div><div className="preview-card-wrap"><StudentCard student={previewStudent} settings={settings} preview /></div><p className="preview-caption">Each student receives a different QR code linked to their unique student ID.</p></section>
      </div>
    </section>
  );
}

function AccountsView({ accounts, onSubmit }) {
  return (
    <section className="view active-view">
      <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> ADMINISTRATION</div><h1>Staff accounts</h1><p className="subheading">Create Security, Teacher, and Admin accounts.</p></div></div>
      <div className="info-callout"><span>!</span><p>Only Admin can create accounts. Security is the only role with access to student records, attendance, reports, and gate scanning.</p></div>
      <section className="panel account-panel"><div className="panel-heading"><div><h2>Create a staff account</h2><p>Use a name and number to sign in on this browser.</p></div></div><form id="account-form" className="account-form" onSubmit={onSubmit}><label className="form-label">Full name<input className="form-input" name="name" required maxLength="80" placeholder="Staff member name" /></label><label className="form-label">Staff / ID number<input className="form-input" name="number" required maxLength="40" placeholder="Unique number" /></label><label className="form-label">Role<select className="form-input" name="role" required defaultValue="Security"><option>Security</option><option>Teacher</option><option>Admin</option></select></label><button className="primary-button" type="submit">Create account</button></form><div className="account-list">{accounts.map((account) => <div className="account-row" key={`${account.role}-${account.number}`}><div><strong>{account.name}</strong><span>{account.number}</span></div><span className="account-role">{account.role}</span></div>)}</div></section>
    </section>
  );
}

function RegisterModal({ onClose, onSubmit }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="register-title">
        <div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> NEW STUDENT</div><h2 id="register-title">Register a student</h2><p>Add student details to create a permanent ID and QR card.</p></div><button className="close-modal" onClick={onClose} aria-label="Close">×</button></div>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label className="form-label">First name <span>*</span><input name="firstName" required maxLength="40" placeholder="e.g. Amina" /></label>
            <label className="form-label">Last name <span>*</span><input name="lastName" required maxLength="40" placeholder="e.g. Otieno" /></label>
            <label className="form-label">Middle name <span className="optional">OPTIONAL</span><input name="middleName" maxLength="40" placeholder="Middle name" /></label>
            <label className="form-label">Course / programme <span>*</span><input name="course" required maxLength="60" placeholder="e.g. Computer Studies" /></label>
            <label className="form-label full-field">Class <span>*</span><select name="className" required defaultValue=""><option value="">Choose a class</option>{DEFAULT_CLASSES.map((item) => <option key={item.name}>{item.name}</option>)}<option>Digital Skills</option><option>Other / To be assigned</option></select></label>
            <label className="form-label full-field">Student photograph <span className="optional">OPTIONAL</span><div className="photo-drop"><span className="photo-icon">▧</span><span><strong>Choose a photo</strong><small>Photo helps security verify identity</small></span><input type="file" name="photo" accept="image/*" /></div></label>
          </div>
          <div className="form-note"><span>✦</span><p>A unique PassGate ID and individual QR code are generated automatically after registration.</p></div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button"><span>✓</span> Register student</button></div>
        </form>
      </section>
    </div>
  );
}

function CardModal({ student, settings, printing, onClose, onPrint }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal card-modal" role="dialog" aria-modal="true" aria-labelledby="card-title">
        <div className="modal-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> STUDENT ID CARD</div><h2 id="card-title">{fullName(student)}’s ID card</h2><p>Unique QR code linked to this student’s permanent ID.</p></div><button className="close-modal" onClick={onClose} aria-label="Close">×</button></div>
        <StudentCard student={student} settings={settings} printing={printing} />
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Done</button><button type="button" className="primary-button" onClick={onPrint}>Print card <span>↗</span></button></div>
      </section>
    </div>
  );
}

function StudentCard({ student, settings, preview = false, printing = false }) {
  const brandName = settings.name?.trim() || 'Your Learning Centre';
  return (
    <div className={`id-card${preview ? ' settings-card' : ''}${printing ? ' print-card' : ''}`}>
      <div className="card-band"><div className="card-brand"><div className="card-brand-logo">{settings.logo ? <img src={settings.logo} alt="Centre logo" /> : initials(brandName)}</div><div><div className="card-brand-name">{brandName}</div><div className="card-brand-label">STUDENT IDENTIFICATION</div></div></div><div className="card-tag">STUDENT ACCESS</div></div>
      <div className="card-body">{student.photo ? <img className="card-photo" src={student.photo} alt={fullName(student)} /> : <div className="card-photo photo-placeholder">♙</div>}<div className="card-info"><div className="card-kicker">STUDENT NAME</div><div className="card-name">{fullName(student)}</div><div className="card-kicker">STUDENT ID</div><div className="card-id">{student.id}</div><div className="card-class">{student.course} · {student.className}</div><div className="card-status">● ACTIVE STUDENT</div></div><div className="card-qr-wrap"><img className="card-qr" src={qrDataUri(student.id)} alt={`Unique QR code for ${student.id}`} /><div className="card-qr-caption">SCAN TO LOOK UP</div></div></div>
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function BrandMark() {
  return <span className="brand-mark"><svg viewBox="0 0 36 36" aria-hidden="true"><path d="M18 3.5 30 8v9.3c0 7.2-4.9 12.4-12 15.2C10.9 29.7 6 24.5 6 17.3V8l12-4.5Z" /><path d="m12.5 18 3.6 3.6 7.8-8.1" /></svg></span>;
}

function Toast({ message }) {
  return <div className={`toast${message ? ' show' : ''}`} role="status"><span>✓</span><span>{message}</span></div>;
}

function viewLabel(view) {
  return {
    dashboard: 'Overview',
    students: 'Students',
    gate: 'Gate check-in',
    attendance: 'Attendance',
    classes: 'Classes & schedule',
    reports: 'Reports',
    settings: 'Centre settings',
    accounts: 'Staff accounts',
  }[view] || 'Overview';
}

export default App;
