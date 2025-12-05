import React, { useState, useEffect } from 'react';

// 1. IMPORT ELECTRON BRIDGE (SAFE MODE)
// We wrap this in a try-catch to allow the app to run in standard browsers (web mode)
// without crashing, while still enabling Electron features when running as a desktop app.
let ipcRenderer;
try {
  if (window.require) {
    const electron = window.require('electron');
    ipcRenderer = electron.ipcRenderer;
  }
} catch (e) {
  console.log('Running in web mode - Electron features disabled');
}

import { 
  Shield, 
  Users, 
  FileText, 
  DollarSign, 
  AlertCircle, 
  CheckCircle, 
  XCircle, 
  Activity, 
  Plus,
  ArrowRight,
  Menu,
  X,
  Calculator,
  TrendingUp,
  Table,
  Calendar,
  Download,
  Archive,
  Upload,
  RefreshCw // Icon for the update button
} from 'lucide-react';

// --- ACTUARIAL CONSTANTS & MATH ---

const ACTUARIAL_CONSTANTS = {
  A: 0.00022,
  B: 2.7 * Math.pow(10, -6),
  c: 1.124,
  omega: 120,
  n: 15, // Term length
  i: 0.05, // Standard Interest rate
  i_in: 0.02439 // Interest rate for Annuity_In
};

// Derived Constants
const delta = Math.log(1 + ACTUARIAL_CONSTANTS.i); // Standard Force of interest
const delta_in = Math.log(1 + ACTUARIAL_CONSTANTS.i_in); // Force of interest for Annuity_In
const s_const = Math.exp(-ACTUARIAL_CONSTANTS.A);
const g_const = Math.exp(-ACTUARIAL_CONSTANTS.B / Math.log(ACTUARIAL_CONSTANTS.c));

// 1. Survival Function S(x) based on Gompertz-Makeham
// S(x) = s^x * g^(c^x)
const getSx = (x) => {
  return Math.pow(s_const, x) * Math.pow(g_const, Math.pow(ACTUARIAL_CONSTANTS.c, x));
};

// 2. tPx: Probability that a person aged x survives t years
// tPx = S(x+t) / S(x)
const getTpx = (x, t) => {
  const Sx = getSx(x);
  if (Sx === 0) return 0;
  return getSx(x + t) / Sx;
};

// 3. Force of Mortality mu(x)
// mu(x) = A + B * c^x
const getMu = (x) => {
  return ACTUARIAL_CONSTANTS.A + ACTUARIAL_CONSTANTS.B * Math.pow(ACTUARIAL_CONSTANTS.c, x);
};

// 4. Integrands for Simpson's Rule
// Assurance Integrand: e^(-delta*t) * tPx * mu(x+t)
const assuranceIntegrand = (t, x) => {
  return Math.exp(-delta * t) * getTpx(x, t) * getMu(x + t);
};

// Annuity Integrand: e^(-delta*t) * tPx
// Now accepts specificDelta to handle both i=0.05 and i=0.02439
const annuityIntegrand = (t, x, specificDelta) => {
  return Math.exp(-specificDelta * t) * getTpx(x, t);
};

// 5. Simpson's Rule Implementation
// Integrares func(t, x) from 0 to n with N subdivisions
const simpsonsRule = (func, x, n, N = 100) => {
  const h = n / N; // Step size
  let sum = func(0, x) + func(n, x); // f(a) + f(b)

  for (let k = 1; k < N; k++) {
    const t = k * h;
    const factor = (k % 2 === 0) ? 2 : 4; // Even indices * 2, Odd indices * 4
    sum += factor * func(t, x);
  }

  return (h / 3) * sum;
};

// --- MOCK DATA ---

const INITIAL_POLICIES = [
  { id: 'POL-8821', name: 'John Doe', age: 45, type: 'Term Life', coverage: 500000, premium: 350.50, status: 'Active', inceptionDate: '2020-05-15', paidUntil: '2023-12-01', riskFactor: 'Low' },
  { id: 'POL-9932', name: 'Sarah Smith', age: 32, type: 'Term Life', coverage: 250000, premium: 120.25, status: 'Active', inceptionDate: '2022-01-10', paidUntil: '2023-11-01', riskFactor: 'Medium' },
];

const INITIAL_CLAIMS = [
  { id: 'CLM-101', policyId: 'POL-8821', claimant: 'John Doe', amount: 50000, date: '2023-10-15', status: 'Rejected', reason: 'Below Deductible' },
];

const INITIAL_COMPLAINTS = [
  { id: 'TKT-552', policyId: 'POL-9932', customer: 'Sarah Smith', subject: 'Billing Error', status: 'Open', priority: 'High', date: '2023-11-22' },
];

// --- HELPER FUNCTION: CALCULATE SINGLE VALUE AT TIME T ---
const calculateSinglePolicyValue = (policy, durationYears) => {
  const x_initial = policy.age;
  const n_initial = ACTUARIAL_CONSTANTS.n;
  const S = policy.coverage;

  // 1. Calculate P' (Net Premium) at inception (t=0)
  const assurance0 = simpsonsRule(assuranceIntegrand, x_initial, n_initial, 100);
  const annuity0 = simpsonsRule((t, x) => annuityIntegrand(t, x, delta), x_initial, n_initial, 100);
  
  const P_prime = (S * assurance0) / annuity0;

  // 2. Calculate Value at duration t
  const t = Math.max(0, durationYears);
  const x_t = x_initial + t;
  const n_t = n_initial - t;

  if (n_t <= 0) return 0; // Expired

  const assurance_t = simpsonsRule(assuranceIntegrand, x_t, n_t, 100);
  const annuity_t = simpsonsRule((t, x) => annuityIntegrand(t, x, delta), x_t, n_t, 100);
  
  // E(L) = S * Assurance_t - P' * Annuity_t
  const EL = (S * assurance_t) - (P_prime * annuity_t);
  
  return EL;
};


// --- COMPONENTS ---

// 1. UNDERWRITING MODULE
const UnderwritingModule = ({ onCreatePolicy }) => {
  const [formData, setFormData] = useState({
    name: '',
    age: 30,
    smoker: false,
    coverage: 100000,
    history: 'clean'
  });
  const [quote, setQuote] = useState(null);
  const [calculating, setCalculating] = useState(false);

  const calculateActuarialPremium = () => {
    setCalculating(true);
    
    setTimeout(() => {
      try {
        const x = formData.age;
        const S = formData.coverage;
        const n = ACTUARIAL_CONSTANTS.n;

        // 1. Calculate Integrals
        const assuranceValue = simpsonsRule(assuranceIntegrand, x, n, 100);
        const annuityValue = simpsonsRule((t, x) => annuityIntegrand(t, x, delta), x, n, 100);
        const annuityInValue = simpsonsRule((t, x) => annuityIntegrand(t, x, delta_in), x, n, 100);

        // 2. Base Premium P (Gross) calculation for Underwriting
        // Note: Gross Premium still includes expenses as per earlier requirement
        const numerator = (S * assuranceValue) + (annuityInValue * 8000) + 2000;
        let annualPremium = numerator / annuityValue;

        // 3. Apply Loadings
        let loadingMultiplier = 1.0;
        if (formData.smoker) loadingMultiplier += 1.5;
        if (formData.history === 'minor') loadingMultiplier += 0.5;
        if (formData.history === 'major') loadingMultiplier += 2.5;

        const finalAnnualPremium = annualPremium * loadingMultiplier;
        const monthlyPremium = finalAnnualPremium / 12;

        let risk = 'Low';
        if (formData.smoker || formData.history === 'minor') risk = 'Medium';
        if (formData.history === 'major') risk = 'High';

        const approved = (x + n < ACTUARIAL_CONSTANTS.omega);

        setQuote({
          premium: monthlyPremium.toFixed(2),
          annual: finalAnnualPremium.toFixed(2),
          assuranceFactor: assuranceValue.toFixed(5),
          annuityFactor: annuityValue.toFixed(5),
          annuityInFactor: annuityInValue.toFixed(5),
          risk: risk,
          approved: approved
        });
      } catch (err) {
        console.error(err);
        alert("Calculation Error");
      } finally {
        setCalculating(false);
      }
    }, 500);
  };

  const handleIssuePolicy = () => {
    const newPolicy = {
      id: `POL-${Math.floor(Math.random() * 9000) + 1000}`,
      name: formData.name,
      age: formData.age,
      type: `Term Life (${ACTUARIAL_CONSTANTS.n} Yr)`,
      coverage: formData.coverage,
      premium: quote.premium,
      status: 'Pending Doc',
      inceptionDate: new Date().toISOString().split('T')[0],
      paidUntil: new Date().toISOString().split('T')[0],
      riskFactor: quote.risk
    };
    onCreatePolicy(newPolicy);
    setQuote(null);
    setFormData({ name: '', age: 30, smoker: false, coverage: 100000, history: 'clean' });
    alert("Policy Created! Please upload signed policy document in Admin tab to Activate.");
  };

  const generateWordDocument = () => {
    if (!quote) return;
    const content = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Policy Schedule</title></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h1 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">Majeng Life Insurance Co.</h1>
        <h2 style="color: #475569;">Policy Schedule - Draft Illustration</h2>
        <p><strong>Date Generated:</strong> ${new Date().toLocaleDateString()}</p>
        <br/>
        <h3 style="background-color: #f1f5f9; padding: 10px;">1. Policyholder Details</h3>
        <table border="0" cellpadding="8" cellspacing="0" style="width: 100%; border-collapse: collapse;">
          <tr><td width="200" style="border-bottom: 1px solid #e2e8f0;"><strong>Name:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">${formData.name}</td></tr>
          <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong>Age at Entry:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">${formData.age}</td></tr>
          <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong>Smoker Status:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">${formData.smoker ? 'Yes' : 'No'}</td></tr>
          <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong>Medical History:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">${formData.history}</td></tr>
        </table>
        <br/>
        <h3 style="background-color: #f1f5f9; padding: 10px;">2. Coverage Details</h3>
        <table border="0" cellpadding="8" cellspacing="0" style="width: 100%; border-collapse: collapse;">
          <tr><td width="200" style="border-bottom: 1px solid #e2e8f0;"><strong>Product Type:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">Term Life Assurance</td></tr>
          <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong>Policy Term:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">${ACTUARIAL_CONSTANTS.n} Years</td></tr>
          <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong>Sum Insured:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">R ${formData.coverage.toLocaleString()}</td></tr>
        </table>
        <br/>
        <h3 style="background-color: #f1f5f9; padding: 10px;">3. Premium Summary</h3>
        <table border="0" cellpadding="8" cellspacing="0" style="width: 100%; border-collapse: collapse;">
          <tr><td width="200" style="border-bottom: 1px solid #e2e8f0;"><strong>Risk Category:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">${quote.risk}</td></tr>
          <tr><td style="border-bottom: 1px solid #e2e8f0;"><strong>Total Annual Premium:</strong></td><td style="border-bottom: 1px solid #e2e8f0;">R ${quote.annual}</td></tr>
          <tr style="background-color: #e0f2fe;"><td style="border-bottom: 1px solid #bae6fd;"><strong>Monthly Premium:</strong></td><td style="border-bottom: 1px solid #bae6fd;"><strong>R ${quote.premium}</strong></td></tr>
        </table>
        <br/><br/><br/>
        <p style="font-size: 10px; color: #64748b;">This document is a computer-generated illustration based on the underwriting parameters provided. It does not constitute a final binding contract until the policy is formally issued and the first premium is received.</p>
      </body>
      </html>
    `;
    const blob = new Blob(['\ufeff', content], { type: 'application/msword' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `Policy_Draft_${formData.name.replace(/\s+/g, '_')}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-sm">
      <h2 className="text-xl font-bold mb-4 flex items-center text-slate-800">
        <Calculator className="mr-2 text-blue-600" /> Actuarial Underwriting
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded text-sm text-blue-800 border border-blue-200">
             <strong>Model parameters:</strong> Term (n)=15.
             <br/>i=5% (Base), i=2.439% (Expense).
             <br/>Using Gompertz-Makeham Mortality.
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Applicant Name</label>
            <input 
              type="text" 
              className="mt-1 w-full border rounded-md p-2 bg-slate-50"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>
          <div className="flex space-x-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">Age (x)</label>
              <input 
                type="number" 
                className="mt-1 w-full border rounded-md p-2 bg-slate-50"
                value={formData.age}
                onChange={e => setFormData({...formData, age: parseInt(e.target.value)})}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">Smoker?</label>
              <select 
                className="mt-1 w-full border rounded-md p-2 bg-slate-50"
                value={formData.smoker}
                onChange={e => setFormData({...formData, smoker: e.target.value === 'true'})}
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Medical History</label>
            <select 
              className="mt-1 w-full border rounded-md p-2 bg-slate-50"
              value={formData.history}
              onChange={e => setFormData({...formData, history: e.target.value})}
            >
              <option value="clean">Clean History</option>
              <option value="minor">Minor Issues (Load +50%)</option>
              <option value="major">Major Issues (Load +250%)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Coverage Amount (S)</label>
            <input 
              type="number" 
              className="mt-1 w-full border rounded-md p-2 bg-slate-50"
              value={formData.coverage}
              onChange={e => setFormData({...formData, coverage: parseInt(e.target.value)})}
            />
          </div>
          <button 
            onClick={calculateActuarialPremium}
            disabled={calculating}
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition flex justify-center items-center"
          >
            {calculating ? 'Integrating...' : 'Calculate Actuarial Premium'}
          </button>
        </div>

        <div className="bg-slate-50 p-6 rounded-lg border flex flex-col justify-center items-center">
          {!quote ? (
            <div className="text-center text-slate-400">
                <Calculator className="w-12 h-12 mx-auto mb-2 opacity-20" />
                <p>Run calculation to view premium breakdown.</p>
            </div>
          ) : (
            <div className="w-full space-y-4">
              <div className={`text-center pb-4 border-b ${quote.approved ? 'text-green-600' : 'text-red-600'}`}>
                <span className="text-3xl font-bold">{quote.approved ? 'APPROVED' : 'DECLINED'}</span>
              </div>
              
              {quote.approved && (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm text-slate-600">
                    <div>Assurance Int.: <span className="font-mono text-slate-900">{quote.assuranceFactor}</span></div>
                    <div>Annuity Int.: <span className="font-mono text-slate-900">{quote.annuityFactor}</span></div>
                    <div>Annuity (In) Int.: <span className="font-mono text-slate-900">{quote.annuityInFactor}</span></div>
                    <div>Annual Base: <span className="font-medium text-slate-900">R {quote.annual}</span></div>
                  </div>

                  <div className="bg-white p-4 rounded border text-center mt-4">
                    <p className="text-sm text-slate-500 uppercase tracking-wide">Monthly Premium</p>
                    <p className="text-4xl font-bold text-blue-600">R {quote.premium}</p>
                  </div>

                  <button 
                    onClick={handleIssuePolicy}
                    className="w-full mt-4 bg-green-600 text-white py-2 rounded-md hover:bg-green-700 flex items-center justify-center shadow-md"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" /> Bind Policy
                  </button>

                  <button 
                    onClick={generateWordDocument}
                    className="w-full mt-2 bg-white text-blue-600 border border-blue-600 py-2 rounded-md hover:bg-blue-50 flex items-center justify-center shadow-sm"
                  >
                    <Download className="w-4 h-4 mr-2" /> Download Policy Draft (.doc)
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 2. POLICY VALUES MODULE
const PolicyValuesModule = ({ policies }) => {
  const [activeSubTab, setActiveSubTab] = useState('projection');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [projection, setProjection] = useState(null);
  const [portfolioValuation, setPortfolioValuation] = useState([]);

  const handleGenerateValues = () => {
    const policy = policies.find(p => p.id === selectedPolicyId);
    if (!policy) return;

    const x_initial = policy.age;
    const n_initial = ACTUARIAL_CONSTANTS.n;
    const S = policy.coverage;

    const assurance0 = simpsonsRule(assuranceIntegrand, x_initial, n_initial, 100);
    const annuity0 = simpsonsRule((t, x) => annuityIntegrand(t, x, delta), x_initial, n_initial, 100);
    
    const P_prime = (S * assurance0) / annuity0;

    const values = [];
    
    for (let t = 0; t <= n_initial; t++) {
        const x_t = x_initial + t;
        const n_t = n_initial - t;

        let EL = 0;
        let assurance_t = 0;
        let annuity_t = 0;

        if (n_t > 0) {
            assurance_t = simpsonsRule(assuranceIntegrand, x_t, n_t, 100);
            annuity_t = simpsonsRule((t, x) => annuityIntegrand(t, x, delta), x_t, n_t, 100);
            EL = (S * assurance_t) - (P_prime * annuity_t);
        }

        values.push({
            year: t,
            age: x_t,
            termRemaining: n_t,
            assurance: assurance_t,
            annuity: annuity_t,
            policyValue: EL
        });
    }

    setProjection({ policy, P_prime, values });
  };

  useEffect(() => {
    if (activeSubTab === 'valuation') {
      const activePolicies = policies.filter(p => p.status === 'Active');
      const currentYear = new Date().getFullYear();
      
      const valuationData = activePolicies.map(policy => {
        const inceptionYear = new Date(policy.inceptionDate).getFullYear();
        const duration = Math.max(0, currentYear - inceptionYear);
        const currentValue = calculateSinglePolicyValue(policy, duration);
        
        return {
          ...policy,
          duration,
          currentValue
        };
      });
      setPortfolioValuation(valuationData);
    }
  }, [activeSubTab, policies]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold flex items-center text-slate-800">
          <TrendingUp className="mr-2 text-purple-600" /> Policy Value Analysis
        </h2>
        <div className="bg-slate-100 p-1 rounded-lg flex text-sm font-medium">
          <button 
            onClick={() => setActiveSubTab('projection')}
            className={`px-4 py-2 rounded-md transition ${activeSubTab === 'projection' ? 'bg-white shadow text-purple-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Individual Projection
          </button>
          <button 
            onClick={() => setActiveSubTab('valuation')}
            className={`px-4 py-2 rounded-md transition ${activeSubTab === 'valuation' ? 'bg-white shadow text-purple-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Current Valuation
          </button>
        </div>
      </div>

      {activeSubTab === 'projection' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">Select Active Policy</label>
                <select 
                  className="w-full border rounded-md p-2 bg-slate-50"
                  value={selectedPolicyId}
                  onChange={e => setSelectedPolicyId(e.target.value)}
                >
                  <option value="">-- Choose Policy --</option>
                  {policies.filter(p => p.status === 'Active').map(p => (
                    <option key={p.id} value={p.id}>{p.id} - {p.name}</option>
                  ))}
                </select>
              </div>
              <button 
                onClick={handleGenerateValues}
                disabled={!selectedPolicyId}
                className="bg-purple-600 text-white px-6 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                Generate Projection
              </button>
            </div>
          </div>

          {projection && (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="p-4 bg-purple-50 border-b border-purple-100">
                 <div className="flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-purple-900">Valuation Results: {projection.policy.name}</h3>
                        <p className="text-sm text-purple-700">Sum Insured (S): R {projection.policy.coverage.toLocaleString()} | Net Premium (P'): R {projection.P_prime.toFixed(2)}</p>
                    </div>
                 </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-xs">
                    <tr>
                      <th className="p-3">Year (t)</th>
                      <th className="p-3">Age (x+t)</th>
                      <th className="p-3">Term Left (n-t)</th>
                      <th className="p-3">Assurance Factor</th>
                      <th className="p-3">Annuity Factor</th>
                      <th className="p-3 text-right">Policy Value E(L)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {projection.values.map((row) => (
                      <tr key={row.year} className="hover:bg-slate-50">
                        <td className="p-3 font-mono">{row.year}</td>
                        <td className="p-3">{row.age}</td>
                        <td className="p-3">{row.termRemaining}</td>
                        <td className="p-3 font-mono text-slate-500">{row.assurance.toFixed(5)}</td>
                        <td className="p-3 font-mono text-slate-500">{row.annuity.toFixed(5)}</td>
                        <td className={`p-3 text-right font-bold ${row.policyValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          R {row.policyValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'valuation' && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden border">
           <div className="p-4 bg-purple-50 border-b border-purple-100 flex justify-between items-center">
             <h3 className="font-bold text-purple-900">Portfolio Valuation Snapshot ({new Date().getFullYear()})</h3>
             <div className="text-sm text-purple-800 font-medium">
               Total Reserve: R {portfolioValuation.reduce((acc, curr) => acc + curr.currentValue, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
             </div>
           </div>
           <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 uppercase text-xs">
                <tr>
                  <th className="p-3">Policy ID</th>
                  <th className="p-3">Holder</th>
                  <th className="p-3">Inception Date</th>
                  <th className="p-3">Duration (Yrs)</th>
                  <th className="p-3 text-right">Current Reserve E(L)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {portfolioValuation.length === 0 ? (
                  <tr><td colSpan="5" className="p-6 text-center text-slate-500">No active policies found.</td></tr>
                ) : (
                  portfolioValuation.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono">{row.id}</td>
                      <td className="p-3 font-medium">{row.name}</td>
                      <td className="p-3 flex items-center"><Calendar className="w-3 h-3 mr-1 text-slate-400"/> {row.inceptionDate}</td>
                      <td className="p-3">{row.duration}</td>
                      <td className={`p-3 text-right font-bold ${row.currentValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        R {row.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// 3. ADMIN MODULE
const AdminModule = ({ policies, onUploadPolicy }) => {
  const activePolicies = policies.filter(p => p.status !== 'Archived');
  const archivedPolicies = policies.filter(p => p.status === 'Archived');

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold flex items-center text-slate-800"><Users className="mr-2 text-indigo-600" /> Active Policy Administration</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-600 uppercase text-xs">
              <tr>
                <th className="p-4">Policy ID</th>
                <th className="p-4">Holder</th>
                <th className="p-4">Inception</th>
                <th className="p-4">Coverage</th>
                <th className="p-4">Premium (Mo)</th>
                <th className="p-4">Paid Until</th>
                <th className="p-4">Status</th>
                <th className="p-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {activePolicies.length === 0 ? (
                 <tr><td colSpan="8" className="p-6 text-center text-slate-500">No active policies.</td></tr>
              ) : (
                activePolicies.map(policy => (
                  <tr key={policy.id} className="hover:bg-slate-50">
                    <td className="p-4 font-mono text-xs">{policy.id}</td>
                    <td className="p-4 font-medium">
                      {policy.name}
                      <div className="text-xs text-slate-400">{policy.type}</div>
                    </td>
                    <td className="p-4 text-slate-500 text-sm">{policy.inceptionDate}</td>
                    <td className="p-4">R {policy.coverage.toLocaleString()}</td>
                    <td className="p-4 font-mono">R {policy.premium}</td>
                    <td className="p-4 text-sm text-slate-500">{policy.paidUntil}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                        policy.status === 'Active' 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {policy.status}
                      </span>
                    </td>
                    <td className="p-4">
                        {policy.status === 'Pending Doc' && (
                            <button 
                                onClick={() => onUploadPolicy(policy.id)}
                                className="flex items-center text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-3 py-1 rounded hover:bg-indigo-100"
                            >
                                <Upload className="w-3 h-3 mr-1" /> Upload
                            </button>
                        )}
                        {policy.status === 'Active' && (
                             <span className="text-xs text-slate-400 italic">Complete</span>
                        )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-50 rounded-lg shadow-inner overflow-hidden border border-slate-200">
        <div className="p-4 border-b border-slate-200 bg-slate-100">
          <h3 className="text-lg font-bold flex items-center text-slate-600"><Archive className="mr-2 w-5 h-5" /> Policy Archive (Deceased/Terminated)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500 uppercase text-xs">
              <tr>
                <th className="p-3">Policy ID</th>
                <th className="p-3">Holder</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {archivedPolicies.length === 0 ? (
                 <tr><td colSpan="4" className="p-6 text-center text-slate-400 italic">No archived policies.</td></tr>
              ) : (
                archivedPolicies.map(policy => (
                  <tr key={policy.id} className="text-slate-500">
                    <td className="p-3 font-mono">{policy.id}</td>
                    <td className="p-3 font-medium">{policy.name}</td>
                    <td className="p-3">{policy.reason || 'Death Claim'}</td>
                    <td className="p-3"><span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded text-xs font-bold">Archived</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// 4. CLAIMS MODULE (UPDATED WITH SETTLEMENT UPLOAD & REJECTION REASON)
const ClaimsModule = ({ claims, policies, onAddClaim, onUpdateClaimStatus }) => {
  const [newClaim, setNewClaim] = useState({ policyId: '' });
  const [showForm, setShowForm] = useState(false);
  
  // State for Claim Action Processing
  const [actionClaimId, setActionClaimId] = useState(null);
  const [actionType, setActionType] = useState(null); // 'Approve' or 'Reject'
  const [rejectReason, setRejectReason] = useState('');
  const [hasUploadedForm, setHasUploadedForm] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const policy = policies.find(p => p.id === newClaim.policyId);
    
    if (!policy) {
      alert("Policy ID not found");
      return;
    }

    if (policy.status === 'Archived') {
        alert("This policy is already archived.");
        return;
    }

    if (policy.status === 'Pending Doc') {
        alert("Cannot file claim. Policy is not active (Pending Documents).");
        return;
    }
    
    onAddClaim({
      id: `CLM-${Math.floor(Math.random() * 1000)}`,
      policyId: newClaim.policyId,
      claimant: policy.name,
      amount: policy.coverage,
      date: new Date().toISOString().split('T')[0],
      status: 'Pending',
      reason: 'Death of Insured'
    });
    setNewClaim({ policyId: '' });
    setShowForm(false);
  };

  const initiateAction = (id, type) => {
    if (actionClaimId === id && actionType === type) {
        // Toggle closed if clicking same button
        setActionClaimId(null);
        setActionType(null);
    } else {
        setActionClaimId(id);
        setActionType(type);
        setRejectReason('');
        setHasUploadedForm(false);
    }
  };

  const handleConfirmAction = (id) => {
    if (actionType === 'Approve') {
        onUpdateClaimStatus(id, 'Approved');
    } else if (actionType === 'Reject') {
        onUpdateClaimStatus(id, 'Rejected', rejectReason);
    }
    setActionClaimId(null);
    setActionType(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold flex items-center text-slate-800"><FileText className="mr-2 text-red-600" /> Claims Processing</h2>
        <button onClick={() => setShowForm(!showForm)} className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 flex items-center">
          <Plus className="w-4 h-4 mr-2" /> New Claim
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-red-100">
          <h3 className="font-bold mb-4">File New Claim</h3>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">Policy ID</label>
                <input 
                placeholder="Enter Policy ID (e.g. POL-8821)" 
                className="w-full border p-2 rounded"
                value={newClaim.policyId}
                onChange={e => setNewClaim({...newClaim, policyId: e.target.value})}
                required
                />
            </div>
            <div className="flex-1 text-sm text-slate-500 pb-3 italic">
                * Amount will default to Sum Insured.
                <br/>* Reason defaults to Death of Insured.
            </div>
            <button type="submit" className="bg-slate-800 text-white px-6 py-2 rounded hover:bg-slate-900">Submit to Adjudication</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4">
        {claims.map(claim => (
          <div key={claim.id} className="bg-white rounded-lg shadow-sm border-l-4 border-l-indigo-500 overflow-hidden">
            <div className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center">
                <div>
                <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-slate-500">{claim.id}</span>
                    <span className="text-sm text-slate-400">for {claim.policyId}</span>
                </div>
                <h4 className="text-lg font-bold mt-1">R {claim.amount.toLocaleString()} - {claim.claimant}</h4>
                <p className="text-sm text-slate-600">{claim.reason} • Filed: {claim.date}</p>
                </div>
                
                <div className="mt-4 md:mt-0 flex items-center space-x-3">
                {claim.status === 'Pending' ? (
                    <>
                    <button onClick={() => initiateAction(claim.id, 'Approve')} className={`p-2 rounded hover:bg-green-50 ${actionClaimId === claim.id && actionType === 'Approve' ? 'bg-green-50 ring-2 ring-green-500' : 'text-green-600'}`} title="Approve"><CheckCircle className="w-6 h-6" /></button>
                    <button onClick={() => initiateAction(claim.id, 'Reject')} className={`p-2 rounded hover:bg-red-50 ${actionClaimId === claim.id && actionType === 'Reject' ? 'bg-red-50 ring-2 ring-red-500' : 'text-red-600'}`} title="Reject"><XCircle className="w-6 h-6" /></button>
                    </>
                ) : (
                    <span className={`px-3 py-1 rounded-full font-bold text-sm ${claim.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {claim.status}
                    </span>
                )}
                </div>
            </div>

            {/* ACTION SUB-PANEL */}
            {actionClaimId === claim.id && claim.status === 'Pending' && (
                <div className="bg-slate-50 border-t p-4 transition-all">
                    {actionType === 'Approve' && (
                        <div className="flex flex-col gap-3">
                            <p className="text-sm font-bold text-slate-700">Approval Requirement: Settlement Form</p>
                            <div className="flex gap-4 items-center">
                                <button 
                                    onClick={() => setHasUploadedForm(true)}
                                    className={`flex items-center px-4 py-2 rounded text-sm border ${hasUploadedForm ? 'bg-green-100 text-green-700 border-green-300' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}
                                >
                                    <Upload className="w-4 h-4 mr-2" />
                                    {hasUploadedForm ? 'Form Uploaded' : 'Upload Settlement Form'}
                                </button>
                                <button 
                                    onClick={() => handleConfirmAction(claim.id)}
                                    disabled={!hasUploadedForm}
                                    className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Confirm Approval & Archive Policy
                                </button>
                            </div>
                        </div>
                    )}

                    {actionType === 'Reject' && (
                        <div className="flex flex-col gap-3">
                            <p className="text-sm font-bold text-slate-700">Rejection Requirement: Reason for Denial</p>
                            <div className="flex gap-4 items-center">
                                <input 
                                    type="text" 
                                    placeholder="Enter reason for rejection..."
                                    className="flex-1 border p-2 rounded text-sm"
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                />
                                <button 
                                    onClick={() => handleConfirmAction(claim.id)}
                                    disabled={!rejectReason.trim()}
                                    className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Confirm Rejection
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// 5. PREMIUM MODULE
const PremiumModule = ({ policies, onProcessPayment }) => {
  return (
    <div className="bg-white rounded-lg shadow-sm">
      <div className="p-6 border-b">
        <h2 className="text-xl font-bold flex items-center text-slate-800"><DollarSign className="mr-2 text-green-600" /> Premium Collection</h2>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.filter(p => p.status === 'Active').map(policy => { 
            const isLate = new Date(policy.paidUntil) < new Date();
            return (
              <div key={policy.id} className="border rounded-lg p-4 hover:shadow-md transition">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold">{policy.name}</h3>
                    <p className="text-xs text-slate-500 font-mono">{policy.id}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg">R {policy.premium}</p>
                    <p className="text-xs text-slate-500">Monthly</p>
                  </div>
                </div>
                
                <div className="my-4">
                  <div className="text-sm flex justify-between">
                    <span>Paid Until:</span>
                    <span className={isLate ? 'text-red-500 font-bold' : 'text-green-600 font-bold'}>{policy.paidUntil}</span>
                  </div>
                  {isLate && <div className="text-xs text-red-500 mt-1 flex items-center"><AlertCircle className="w-3 h-3 mr-1" /> Payment Overdue</div>}
                </div>

                <button 
                  onClick={() => onProcessPayment(policy.id)}
                  className="w-full bg-slate-800 text-white py-2 rounded text-sm hover:bg-slate-700 flex justify-center items-center"
                >
                  Process Payment <ArrowRight className="w-3 h-3 ml-1" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// 6. COMPLAINTS MODULE
const ComplaintsModule = ({ complaints, policies, onResolveComplaint, onAddComplaint }) => {
  const [showForm, setShowForm] = useState(false);
  const [newComplaint, setNewComplaint] = useState({
    policyId: '',
    subject: '',
    priority: 'Low'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const policy = policies.find(p => p.id === newComplaint.policyId);
    const customerName = policy ? policy.name : 'Unknown / Non-Active Policy';

    onAddComplaint({
      id: `TKT-${Math.floor(Math.random() * 9000) + 1000}`,
      policyId: newComplaint.policyId,
      customer: customerName,
      subject: newComplaint.subject,
      status: 'Open',
      priority: newComplaint.priority,
      date: new Date().toISOString().split('T')[0]
    });

    setNewComplaint({ policyId: '', subject: '', priority: 'Low' });
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold flex items-center text-slate-800"><AlertCircle className="mr-2 text-orange-600" /> Complaints Management</h2>
        <button onClick={() => setShowForm(!showForm)} className="bg-orange-600 text-white px-4 py-2 rounded-md hover:bg-orange-700 flex items-center">
          <Plus className="w-4 h-4 mr-2" /> New Complaint
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-sm border border-orange-100">
          <h3 className="font-bold mb-4">Log New Complaint</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Policy ID</label>
              <input 
                placeholder="e.g. POL-8821" 
                className="w-full border p-2 rounded"
                value={newComplaint.policyId}
                onChange={e => setNewComplaint({...newComplaint, policyId: e.target.value})}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Issue / Subject</label>
              <input 
                placeholder="Brief description" 
                className="w-full border p-2 rounded"
                value={newComplaint.subject}
                onChange={e => setNewComplaint({...newComplaint, subject: e.target.value})}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">Priority</label>
              <select 
                className="w-full border p-2 rounded bg-white"
                value={newComplaint.priority}
                onChange={e => setNewComplaint({...newComplaint, priority: e.target.value})}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
             <button type="submit" className="bg-slate-800 text-white px-6 py-2 rounded hover:bg-slate-900">Log Ticket</button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="p-4">Ticket ID</th>
              <th className="p-4">Customer</th>
              <th className="p-4">Issue</th>
              <th className="p-4">Priority</th>
              <th className="p-4">Status</th>
              <th className="p-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {complaints.map(ticket => (
              <tr key={ticket.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="p-4 font-mono text-xs">{ticket.id}</td>
                <td className="p-4">
                  <div className="font-medium">{ticket.customer}</div>
                  <div className="text-xs text-slate-400">{ticket.policyId}</div>
                </td>
                <td className="p-4 text-slate-600">{ticket.subject}</td>
                <td className="p-4">
                  <span className={`text-xs px-2 py-1 rounded ${ticket.priority === 'High' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}`}>
                    {ticket.priority}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`text-xs font-bold ${ticket.status === 'Resolved' ? 'text-green-600' : 'text-slate-600'}`}>
                    {ticket.status}
                  </span>
                </td>
                <td className="p-4">
                  {ticket.status !== 'Resolved' && (
                    <button 
                      onClick={() => onResolveComplaint(ticket.id)}
                      className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                    >
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [policies, setPolicies] = useState(INITIAL_POLICIES);
  const [claims, setClaims] = useState(INITIAL_CLAIMS);
  const [complaints, setComplaints] = useState(INITIAL_COMPLAINTS);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('Idle');
  const [showRestartButton, setShowRestartButton] = useState(false);

  // Stats for Dashboard
  const totalPremium = policies.reduce((acc, curr) => acc + (curr.status === 'Active' ? parseFloat(curr.premium) : 0), 0);
  const activeCount = policies.filter(p => p.status === 'Active').length;
  const pendingClaims = claims.filter(c => c.status === 'Pending').length;

  useEffect(() => {
    // Listen for update messages from Main process
    if (ipcRenderer) {
      ipcRenderer.on('update-message', (event, text) => {
        setUpdateStatus(text);
      });
      ipcRenderer.on('update-downloaded', () => {
        setShowRestartButton(true);
        setUpdateStatus('Update Downloaded!');
      });
    }
    return () => {
      if (ipcRenderer) {
        ipcRenderer.removeAllListeners('update-message');
        ipcRenderer.removeAllListeners('update-downloaded');
      }
    };
  }, []);

  const checkForUpdate = () => {
    if (ipcRenderer) {
      ipcRenderer.send('check-for-update');
      setUpdateStatus('Checking...');
    }
  };

  const restartAndInstall = () => {
    if (ipcRenderer) {
      ipcRenderer.send('restart-app');
    }
  };

  // Handlers
  const handleCreatePolicy = (policy) => {
    setPolicies([policy, ...policies]);
    setActiveTab('admin');
  };

  const handleProcessPayment = (policyId) => {
    setPolicies(policies.map(p => {
      if (p.id === policyId) {
        const current = new Date(p.paidUntil);
        current.setMonth(current.getMonth() + 1);
        return { ...p, paidUntil: current.toISOString().split('T')[0], status: 'Active' };
      }
      return p;
    }));
    alert("Payment Processed. Valid date extended.");
  };

  const handleAddClaim = (claim) => {
    setClaims([claim, ...claims]);
  };

  const handleAddComplaint = (complaint) => {
    setComplaints([complaint, ...complaints]);
  };

  const handleUpdateClaimStatus = (id, status, reason = null) => {
    setClaims(prevClaims => prevClaims.map(c => {
        if (c.id === id) {
            return { 
                ...c, 
                status, 
                reason: (status === 'Rejected' && reason) ? reason : c.reason 
            };
        }
        return c;
    }));

    if (status === 'Approved') {
        const claim = claims.find(c => c.id === id);
        if (claim) {
            setPolicies(prevPolicies => prevPolicies.map(p => 
                p.id === claim.policyId 
                ? { ...p, status: 'Archived', reason: 'Death Claim Approved' } 
                : p
            ));
        }
    }
  };

  const handleResolveComplaint = (id) => {
    setComplaints(complaints.map(c => c.id === id ? { ...c, status: 'Resolved' } : c));
  };
  
  const handleUploadPolicyDoc = (id) => {
    setPolicies(policies.map(p => {
      if (p.id === id) {
        return { ...p, status: 'Active' };
      }
      return p;
    }));
    alert("Policy Document Uploaded. Status set to Active.");
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'underwriting': return <UnderwritingModule onCreatePolicy={handleCreatePolicy} />;
      case 'admin': return <AdminModule policies={policies} onUploadPolicy={handleUploadPolicyDoc} />;
      case 'policyValues': return <PolicyValuesModule policies={policies} />;
      case 'claims': return <ClaimsModule claims={claims} policies={policies} onAddClaim={handleAddClaim} onUpdateClaimStatus={handleUpdateClaimStatus} />;
      case 'premium': return <PremiumModule policies={policies} onProcessPayment={handleProcessPayment} />;
      case 'complaints': return <ComplaintsModule complaints={complaints} policies={policies} onResolveComplaint={handleResolveComplaint} onAddComplaint={handleAddComplaint} />;
      default: return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl p-6 text-white shadow-lg">
            <h3 className="text-blue-100 uppercase text-xs font-bold tracking-wider mb-2">Total Monthly Revenue</h3>
            <div className="text-4xl font-bold">R {totalPremium.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-slate-500 uppercase text-xs font-bold tracking-wider mb-2">Active Policies</h3>
            <div className="text-4xl font-bold text-slate-800">{activeCount}</div>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-slate-500 uppercase text-xs font-bold tracking-wider mb-2">Pending Claims</h3>
            <div className="text-4xl font-bold text-red-600">{pendingClaims}</div>
          </div>
          
          <div className="md:col-span-3 bg-white p-6 rounded-xl shadow-sm border border-slate-100 mt-4">
            <h3 className="text-lg font-bold text-slate-800 mb-4">System Overview</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-600">
              <p>Welcome to <strong>Majeng Life Core Admin</strong>. Use the sidebar to navigate the operational modules.</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Automated risk assessment in Underwriting</li>
                <li>Real-time claim adjudication workflow</li>
                <li>Policy ledger and status tracking</li>
              </ul>
            </div>
          </div>
        </div>
      );
    }
  };

  const NavItem = ({ id, label, icon: Icon }) => (
    <button 
      onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
      className={`w-full flex items-center p-3 rounded-lg transition-colors mb-1 ${activeTab === id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
    >
      <Icon className="w-5 h-5 mr-3" />
      {label}
    </button>
  );

  return (
    <div className="flex h-screen bg-slate-100 font-sans text-slate-900">
      {/* Sidebar - Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r h-full">
        <div className="p-6 border-b flex items-center">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center mr-3">
            <Shield className="text-white w-5 h-5" />
          </div>
          <span className="text-xl font-bold text-slate-800">Majeng Life</span>
        </div>
        <nav className="flex-1 p-4 overflow-y-auto">
          <NavItem id="dashboard" label="Dashboard" icon={Activity} />
          <div className="my-4 border-t border-slate-100"></div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-3">Operations</div>
          <NavItem id="underwriting" label="Underwriting" icon={Calculator} />
          <NavItem id="admin" label="Policy Admin" icon={Users} />
          <NavItem id="premium" label="Collections" icon={DollarSign} />
          <NavItem id="policyValues" label="Policy Values" icon={TrendingUp} />
          <div className="my-4 border-t border-slate-100"></div>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-3">Support</div>
          <NavItem id="claims" label="Claims" icon={AlertCircle} />
          <NavItem id="complaints" label="Complaints" icon={CheckCircle} />
        </nav>
        
        {/* Update Widget */}
        <div className="p-4 border-t bg-slate-50">
          <div className="mb-2">
             <button onClick={checkForUpdate} className="flex items-center text-xs font-medium text-slate-600 hover:text-blue-600">
                <RefreshCw className="w-3 h-3 mr-1" /> Check Updates
             </button>
             <div className="text-[10px] text-slate-400 mt-1">{updateStatus}</div>
          </div>
          {showRestartButton && (
             <button onClick={restartAndInstall} className="w-full bg-green-600 text-white text-xs py-1 rounded">Restart to Update</button>
          )}
          <div className="flex items-center mt-3 pt-3 border-t">
            <div className="w-8 h-8 rounded-full bg-slate-300 flex items-center justify-center text-xs font-bold">AD</div>
            <div className="ml-3">
              <p className="text-sm font-medium">Admin User</p>
              <p className="text-xs text-slate-500">System Administrator</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden bg-white border-b p-4 flex justify-between items-center">
          <div className="flex items-center">
             <Shield className="text-indigo-600 w-6 h-6 mr-2" />
             <span className="font-bold">Majeng Life</span>
          </div>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </header>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-16 left-0 w-full bg-white z-50 border-b p-4 shadow-lg">
            <NavItem id="dashboard" label="Dashboard" icon={Activity} />
            <NavItem id="underwriting" label="Underwriting" icon={Calculator} />
            <NavItem id="admin" label="Policy Admin" icon={Users} />
            <NavItem id="premium" label="Collections" icon={DollarSign} />
            <NavItem id="policyValues" label="Policy Values" icon={TrendingUp} />
            <NavItem id="claims" label="Claims" icon={AlertCircle} />
            <NavItem id="complaints" label="Complaints" icon={CheckCircle} />
          </div>
        )}

        {/* Workspace */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-800 capitalize">{activeTab.replace(/([A-Z])/g, ' $1').trim()}</h1>
              <p className="text-slate-500 text-sm">Manage your insurance operations efficiently.</p>
            </div>
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;